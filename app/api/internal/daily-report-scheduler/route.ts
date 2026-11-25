import { apiError, apiSuccess, ApiCode } from "@/lib/api-codes";
import { startDailyReportScheduler } from "@/lib/daily-report-scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    startDailyReportScheduler();
    return apiSuccess({ started: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[api/internal/daily-report-scheduler] failed:", message);
    return apiError(ApiCode.TASK_EXECUTION_FAILED, message, 500);
  }
}
