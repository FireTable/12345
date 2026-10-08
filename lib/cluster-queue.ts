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

export async function enqueueClusterJob(
  regionId: string,
  taskId: string,
  total: number
): Promise<{ taskId: string; status: string; alreadyQueued: boolean }> {
  await ensureQueueColumns();

  // 队列健壮性：仅在已有 PENDING 时复用；RUNNING 不阻止新建 PENDING 排队
  // （用户要求"有新的数据自动 add"，不能因为旧 job 还在跑就把新工单晾着）。
  // 新建的 PENDING 会自然排到 RUNNING 之后被 claimNextClusterJob 认领。
  //
  // 并发安全：依赖 ensureQueueColumns 创建的 partial unique index
  //   task_progress_pending_per_region (region_id) WHERE status = 'PENDING'
  // 配合 ON CONFLICT (region_id) WHERE status = 'PENDING' DO NOTHING，
  // 让"查 PENDING + 插入 PENDING"在 DB 层面唯一约束兜底，
  // 不依赖 statement-level snapshot（READ COMMITTED 下 WHERE NOT EXISTS 不可靠）。
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
    return { taskId: inserted[0].task_id, status: inserted[0].status, alreadyQueued: false };
  }

  // 输了 race 或 PENDING 已被 claim（unlikely in tight loop）：拿真实现有的 PENDING。
  const existing = await sql<{ task_id: string; status: string }[]>`
    SELECT task_id, status
    FROM task_progress
    WHERE region_id = ${regionId}
      AND status = 'PENDING'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (existing.length > 0) {
    return {
      taskId: existing[0].task_id,
      status: existing[0].status,
      alreadyQueued: true,
    };
  }

  // 极端：SELECT 时 PENDING 已被 claim（worker 抢走了），re-INSERT 一次。
  const retried = await sql<{ task_id: string; status: string }[]>`
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
  if (retried.length > 0) {
    return { taskId: retried[0].task_id, status: retried[0].status, alreadyQueued: false };
  }

  // 兜底再查一次。如果还查不到，抛错（绝不应该）。
  const finalExisting = await sql<{ task_id: string; status: string }[]>`
    SELECT task_id, status
    FROM task_progress
    WHERE region_id = ${regionId}
      AND status = 'PENDING'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (finalExisting.length > 0) {
    return {
      taskId: finalExisting[0].task_id,
      status: finalExisting[0].status,
      alreadyQueued: true,
    };
  }

  throw new Error(
    `enqueueClusterJob: failed to enqueue task for region ${regionId} after retries`
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
}
