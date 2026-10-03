import { NextRequest } from "next/server";
import { buildRecordsFromTexts, insertRecordsBatch } from "@/lib/ticket-ingest";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { getRegionVocabulary } from "@/lib/vocabulary";
import { apiSuccess, apiError, ApiCode } from "@/lib/api-codes";
import { triggerClusterJobAuto } from "@/lib/cluster-runner";

const MAX_LINES = 2000;
const MAX_LINE_CHARS = 4000;

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const regionId = await resolveRequestRegionId(req);
    const body = await req.json().catch(() => null) as { texts?: unknown } | null;
    const rawTexts = Array.isArray(body?.texts) ? body!.texts : null;
    if (!rawTexts) {
      return apiError(ApiCode.INVALID_PARAMS, undefined, 400);
    }

    // ponytail: 每条纯文本做长度截断,避免一行塞进整份文件把 DB 字符串列撑爆。
    const texts = (rawTexts as unknown[])
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.slice(0, MAX_LINE_CHARS));

    if (texts.length === 0) {
      return apiSuccess({
        totalParsed: 0,
        insertedCount: 0,
        duplicateCount: 0,
        failedCount: 0,
        durationMs: 0,
      });
    }
    if (texts.length > MAX_LINES) {
      return apiError(ApiCode.FILE_SIZE_EXCEEDED, `单次粘贴最多 ${MAX_LINES} 条,当前 ${texts.length} 条`, 400);
    }

    const vocab = await getRegionVocabulary(regionId);
    const { records, failedCount: normalizedFailed } = buildRecordsFromTexts(texts, {
      townships: vocab.townships,
      district: vocab.regionName,
      city: vocab.cityName,
      province: vocab.provinceName,
    });
    const { insertedCount, duplicateCount, failedCount: batchFailed } =
      await insertRecordsBatch(records, regionId);
    const failedCount = normalizedFailed + batchFailed;

    // 若有新工单成功入库，后台自动开启研判流水线任务，无需人工干预
    if (insertedCount > 0) {
      triggerClusterJobAuto(regionId).catch((err) => {
        console.warn("[paste/route] Auto cluster trigger warning:", err?.message || err);
      });
    }

    const durationMs = Date.now() - startTime;

    return apiSuccess({
      totalParsed: texts.length,
      insertedCount,
      duplicateCount,
      failedCount,
      durationMs,
    });
  } catch (err: any) {
    console.error("Backend paste ingest error:", err);
    return apiError(ApiCode.FILE_UPLOAD_FAILED, err.message, 500);
  }
}
