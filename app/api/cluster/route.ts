import { NextRequest } from "next/server";
import { getRegionDb } from "@/db/client";
import { ticketsTable } from "@/db/schema";
import { sql } from "drizzle-orm";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { enqueueClusterJob } from "@/lib/cluster-queue";
import { apiSuccess, apiError, ApiCode } from "@/lib/api-codes";
import { triggerClusterJobAuto } from "@/lib/cluster-runner";

export async function POST(req: NextRequest) {
  try {
    let body: { taskId?: string; threadId?: string } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const regionId = await resolveRequestRegionId(req);
    const { db: tenantDb } = await getRegionDb(regionId);
    const countRes = await tenantDb.select({ count: sql<number>`count(*)` }).from(ticketsTable);
    const totalTickets = Number(countRes[0]?.count || 0);
    if (totalTickets === 0) {
      return apiError(ApiCode.TASK_EMPTY_DATA, undefined, 400);
    }

    const taskId = body.taskId || body.threadId || `cluster-${Date.now()}`;
    const queued = await enqueueClusterJob(regionId, taskId, totalTickets);
    triggerClusterJobAuto(regionId).catch((err) => {
      console.warn("[cluster/route] Auto cluster trigger warning:", err?.message || err);
    });
    return apiSuccess({
      taskId: queued.taskId,
      status: queued.status,
      queued: true,
      alreadyRunning: queued.alreadyRunning,
      total: totalTickets,
    });
  } catch (err: any) {
    console.error("Cluster enqueue error:", err);
    return apiError(ApiCode.TASK_EXECUTION_FAILED, err.message, 500);
  }
}

export async function GET() {
  return apiError(ApiCode.BAD_REQUEST, "研判只能 POST /api/cluster 入队；进度请 GET /api/cluster/progress", 405);
}
