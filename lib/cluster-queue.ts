import { sql } from "@/db/client";

export interface ClusterJob {
  taskId: string;
  regionId: string;
  status: string;
  processed: number;
  total: number;
}

// 跨进程互斥：claimNextClusterJob 看到一个 RUNNING 任务如果心跳陈旧（> 此值），
// 就视为前任 worker 已死、可以接手。worker 心跳是 4-5s 一次，30s 是心跳间隔的 6-7 倍，
// 给网络抖动 / DB 短暂卡顿留出充足窗口；再小就容易被健康 worker 误判（pipeline-state
// 历史上每 3s 调一次 trigger，15s 阈值会被它乘以 4-5 次 claim 频繁误抢）。
const STALE_SECONDS = 30;

let columnsReady: Promise<void> | null = null;

export function ensureQueueColumns(): Promise<void> {
  if (!columnsReady) {
    columnsReady = (async () => {
      await sql`ALTER TABLE task_progress ADD COLUMN IF NOT EXISTS region_id varchar(64)`;
      await sql`ALTER TABLE task_progress ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz`;
      // 关键：每个 region 最多一个 PENDING 任务。
      // Partial unique index 配合 ON CONFLICT (region_id) WHERE status='PENDING' DO NOTHING，
      // 让"查 PENDING + 插入 PENDING"真正原子（DB 层面唯一约束兜底，不依赖 statement-level snapshot）。
      // 没有这个 index 时 N 个并发 INSERT ... WHERE NOT EXISTS 都能看到"没 PENDING"，
      // 各插一份 → 重复 PENDING。
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS task_progress_pending_per_region
        ON task_progress (region_id)
        WHERE status = 'PENDING'
      `;
    })().catch((err) => {
      columnsReady = null;
      throw err;
    });
  }
  return columnsReady;
}

export type EnqueueResult = {
  taskId: string;
  status: "PENDING" | "RUNNING";
  alreadyQueued: boolean;
  /**
   * 决策路径：
   * - 'created'   — 之前没有 PENDING 也没有 RUNNING，本次新建了 PENDING
   * - 'pending'   — 已经有 PENDING（任意 heartbeat 状态），复用，不创建新行
   * - 'running'   — 已经有 RUNNING 且心跳 fresh（< STALE_SECONDS），**不创建新 PENDING**，
   *                 也**不要启新 worker**——让当前的 worker 跑完
   * - 'reclaimed' — 已经有 RUNNING 但心跳 stale（> STALE_SECONDS），说明前任 worker 已死，
   *                 我们直接把这一行 heartbeat 刷新 + stage_text 改为"继续未完成的研判"，
   *                 接着启新 worker 接续（task_id 不变，processed 等历史进度都在）
   */
  source: "created" | "pending" | "running" | "reclaimed";
};

export async function enqueueClusterJob(
  regionId: string,
  taskId: string,
  total: number
): Promise<EnqueueResult> {
  await ensureQueueColumns();

  // 决策树：
  //   1. 同 region 已有 PENDING  → 复用（unique partial index 已保证最多一个 PENDING）
  //   2. 同 region 有 RUNNING：
  //      a. heartbeat fresh (< STALE_SECONDS) → 有人正在干，**返回 running 不建新行**
  //      b. heartbeat stale (>= STALE_SECONDS) → 前任 worker 已死，re-claim（UPDATE
  //         heartbeat=now + stage_text=续跑），不创建新行
  //   3. 都没有 → 新建 PENDING
  //
  // 这一套替换之前 "只查 PENDING，不看 RUNNING" 的策略——那是 #2a 场景下
  // 仍然会建新 PENDING 的根本原因（导致同 region 出现 RUNNING + 多个 PENDING 并行）。

  // 第 1 步：查 PENDING
  const pending = await sql<{ task_id: string }[]>`
    SELECT task_id FROM task_progress
    WHERE region_id = ${regionId} AND status = 'PENDING'
    ORDER BY created_at DESC LIMIT 1
  `;
  if (pending.length > 0) {
    return {
      taskId: pending[0].task_id,
      status: "PENDING",
      alreadyQueued: true,
      source: "pending",
    };
  }

  // 第 2 步：查 RUNNING
  const running = await sql<
    { task_id: string; heartbeat_at: Date | null; updated_at: Date | null }[]
  >`
    SELECT task_id, heartbeat_at, updated_at FROM task_progress
    WHERE region_id = ${regionId} AND status = 'RUNNING'
    ORDER BY created_at DESC LIMIT 1
  `;
  if (running.length > 0) {
    const r = running[0];
    // postgres-js 返回 timestamp 为 string，统一转毫秒
    const beatStr = (r.heartbeat_at || r.updated_at) as unknown as string | Date | null;
    const lastBeat = beatStr ? new Date(beatStr).getTime() : 0;
    const ageMs = Date.now() - lastBeat;
    if (lastBeat > 0 && ageMs < STALE_SECONDS * 1000) {
      // 当前还有人在跑，**不要创建新 PENDING、不要启新 worker**
      return {
        taskId: r.task_id,
        status: "RUNNING",
        alreadyQueued: true,
        source: "running",
      };
    }
    // 心跳陈（worker 死了但 DB 行还在）。re-claim：把这一行刷新心跳 + 改 stage_text。
    // 这样：
    //   - 不创建新行（DB 还是同一行 task_id，processed 等历史进度保留）
    //   - 触发方（triggerClusterJobAuto）拿到这个 taskId 启新 worker
    //   - 新 worker 的 claimNextClusterJob 看到同一行已经 RUNNING + fresh heartbeat → 不再 claim
    //     （但因为它已经"在跑"，它会直接 run executeClusterJob；这条 task 行已经被 setup 好）
    await sql`
      UPDATE task_progress
      SET heartbeat_at = now(),
          stage_text = '前任 worker 已退出，本 worker 续跑',
          updated_at = now()
      WHERE task_id = ${r.task_id} AND status = 'RUNNING'
    `;
    return {
      taskId: r.task_id,
      status: "RUNNING",
      alreadyQueued: true,
      source: "reclaimed",
    };
  }

  // 第 3 步：都没有 → 新建 PENDING。
  // 用 unique partial index + ON CONFLICT 防 race（同时两个 enqueue 撞同一 region）。
  const inserted = await sql<{ task_id: string; status: string }[]>`
    INSERT INTO task_progress (
      task_id, status, stage, stage_text, percent, total,
      processed, extracted_count, theme_count, review_count, failed_count,
      region_id, heartbeat_at, updated_at
    ) VALUES (
      ${taskId}, 'PENDING', 'EXTRACTING', '已进入研判队列，等待执行', 0, ${total},
      0, 0, 0, 0, 0,
      ${regionId}, now(), now()
    )
    ON CONFLICT (region_id) WHERE status = 'PENDING' DO NOTHING
    RETURNING task_id, status
  `;
  if (inserted.length > 0) {
    return {
      taskId: inserted[0].task_id,
      status: "PENDING",
      alreadyQueued: false,
      source: "created",
    };
  }

  // Race：两个并发 enqueue 都到第 3 步，一个先 INSERT 成功，另一个被 unique index 拒。
  // 再查一次拿真实现有 PENDING。
  const racer = await sql<{ task_id: string }[]>`
    SELECT task_id FROM task_progress
    WHERE region_id = ${regionId} AND status = 'PENDING'
    ORDER BY created_at DESC LIMIT 1
  `;
  if (racer.length > 0) {
    return {
      taskId: racer[0].task_id,
      status: "PENDING",
      alreadyQueued: true,
      source: "pending",
    };
  }

  throw new Error(
    `enqueueClusterJob: race-unresolved, region ${regionId} has neither PENDING nor RUNNING after INSERT`
  );
}

export async function claimNextClusterJob(targetRegionId?: string): Promise<ClusterJob | null> {
  await ensureQueueColumns();
  const rows = targetRegionId
    ? await sql<
        { task_id: string; region_id: string | null; status: string; processed: number; total: number }[]
      >`
        WITH next_job AS (
          SELECT task_id
          FROM task_progress
          WHERE region_id = ${targetRegionId}
            AND (
              status = 'PENDING'
              OR (
                status = 'RUNNING'
                AND COALESCE(heartbeat_at, updated_at) < now() - make_interval(secs => ${STALE_SECONDS})
              )
            )
            -- 同 region 已有 fresh-RUNNING 任务：说明正在跑，本次 PENDING 排队等它结束。
            -- unique partial index 只防 PENDING 重复；这里防 RUNNING 并行。
            AND NOT EXISTS (
              SELECT 1 FROM task_progress t2
              WHERE t2.region_id = ${targetRegionId}
                AND t2.status = 'RUNNING'
                AND COALESCE(t2.heartbeat_at, t2.updated_at) >= now() - make_interval(secs => ${STALE_SECONDS})
            )
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE task_progress AS task
        SET status = 'RUNNING',
            stage_text = CASE
              WHEN task.status = 'RUNNING' THEN '继续未完成的研判...'
              ELSE task.stage_text
            END,
            heartbeat_at = now(),
            updated_at = now()
        FROM next_job
        WHERE task.task_id = next_job.task_id
        RETURNING task.task_id, task.region_id, task.status, task.processed, task.total
      `
    : await sql<
        { task_id: string; region_id: string | null; status: string; processed: number; total: number }[]
      >`
        WITH next_job AS (
          SELECT task_id
          FROM task_progress
          WHERE region_id IS NOT NULL
            AND (
              status = 'PENDING'
              OR (
                status = 'RUNNING'
                AND COALESCE(heartbeat_at, updated_at) < now() - make_interval(secs => ${STALE_SECONDS})
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM task_progress t2
              WHERE t2.region_id = task_progress.region_id
                AND t2.status = 'RUNNING'
                AND COALESCE(t2.heartbeat_at, t2.updated_at) >= now() - make_interval(secs => ${STALE_SECONDS})
            )
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE task_progress AS task
        SET status = 'RUNNING',
            stage_text = CASE
              WHEN task.status = 'RUNNING' THEN '继续未完成的研判...'
              ELSE task.stage_text
            END,
            heartbeat_at = now(),
            updated_at = now()
        FROM next_job
        WHERE task.task_id = next_job.task_id
        RETURNING task.task_id, task.region_id, task.status, task.processed, task.total
      `;
  const row = rows[0];
  if (!row?.region_id) return null;
  return {
    taskId: row.task_id,
    regionId: row.region_id,
    status: row.status,
    processed: row.processed || 0,
    total: row.total || 0,
  };
}

export async function heartbeatClusterJob(taskId: string): Promise<void> {
  await sql`
    UPDATE task_progress
    SET heartbeat_at = now()
    WHERE task_id = ${taskId} AND status = 'RUNNING'
  `;
}

export async function finishClusterJob(taskId: string, themeCount: number): Promise<void> {
  await sql`
    UPDATE task_progress
    SET status = 'COMPLETED',
        stage = 'COMPLETED',
        percent = 100,
        theme_count = ${themeCount},
        stage_text = ${`研判完成，已聚合 ${themeCount} 个多频主题`},
        heartbeat_at = now(),
        updated_at = now(),
        error = NULL
    WHERE task_id = ${taskId}
  `;
  // WS 广播：terminal 状态写库后立刻通知订阅者，无需前端轮询
  await broadcastFromQueue(taskId);
}

export async function failClusterJob(taskId: string, message: string): Promise<void> {
  await sql`
    UPDATE task_progress
    SET status = 'FAILED',
        error = ${message.slice(0, 500)},
        stage_text = '研判失败',
        heartbeat_at = now(),
        updated_at = now()
    WHERE task_id = ${taskId}
  `;
  await broadcastFromQueue(taskId);
}

/**
 * cluster-queue 状态机写完后调一次：从 DB 拉最新行 → 通过 WS 推给 region 订阅者。
 * 不能复用 updateTaskProgress 路径，因为这里直接走 SQL 不走 progressStore 内存，
 * 所以单独读 DB 拉真值再 broadcast。
 */
async function broadcastFromQueue(taskId: string): Promise<void> {
  try {
    const rows = await sql<{ region_id: string | null }[]>`
      SELECT region_id FROM task_progress WHERE task_id = ${taskId} LIMIT 1
    `;
    const regionId = rows[0]?.region_id;
    if (!regionId) return;
    const { getLatestTaskProgress } = await import("./task-progress");
    const tp = await getLatestTaskProgress(regionId);
    if (!tp) return;
    const { broadcastTaskProgress } = await import("./ws-broadcaster");
    broadcastTaskProgress(regionId, tp);
  } catch {
    /* ws-broadcaster 不可用时静默忽略，保持原 SQL 语义 */
  }
}

