import { sql } from "@/db/client";

export interface ClusterJob {
  taskId: string;
  regionId: string;
  status: string;
  processed: number;
  total: number;
}

const STALE_SECONDS = 15;

let columnsReady: Promise<void> | null = null;

export function ensureQueueColumns(): Promise<void> {
  if (!columnsReady) {
    columnsReady = (async () => {
      await sql`ALTER TABLE task_progress ADD COLUMN IF NOT EXISTS region_id varchar(64)`;
      await sql`ALTER TABLE task_progress ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz`;
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
): Promise<{ taskId: string; status: string; alreadyRunning: boolean }> {
  await ensureQueueColumns();
  const existing = await sql<{ task_id: string; status: string }[]>`
    SELECT task_id, status
    FROM task_progress
    WHERE region_id = ${regionId}
      AND status IN ('PENDING', 'RUNNING')
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (existing.length > 0) {
    return {
      taskId: existing[0].task_id,
      status: existing[0].status,
      alreadyRunning: true,
    };
  }

  await sql`
    INSERT INTO task_progress (
      task_id, status, stage, stage_text, percent, total,
      processed, extracted_count, theme_count, review_count, failed_count,
      region_id, heartbeat_at, updated_at
    ) VALUES (
      ${taskId}, 'PENDING', 'EXTRACTING', '已进入研判队列，等待执行', 0, ${total},
      0, 0, 0, 0, 0,
      ${regionId}, now(), now()
    )
    ON CONFLICT (task_id) DO UPDATE SET
      status = 'PENDING',
      stage = 'EXTRACTING',
      stage_text = '已进入研判队列，等待执行',
      percent = 0,
      total = ${total},
      error = NULL,
      region_id = ${regionId},
      heartbeat_at = now(),
      updated_at = now()
  `;
  return { taskId, status: "PENDING", alreadyRunning: false };
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
