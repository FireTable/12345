import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { buildRecordsFromRows, insertRecordsBatch } from "@/lib/ticket-ingest";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { getRegionVocabulary } from "@/lib/vocabulary";
import { apiSuccess, apiError, ApiCode } from "@/lib/api-codes";
import { triggerClusterJobAuto } from "@/lib/cluster-runner";

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const regionId = await resolveRequestRegionId(req);
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return apiError(ApiCode.FILE_EMPTY, undefined, 400);
    }

    const fileName = file.name.toLowerCase();
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let rawRows: Record<string, any>[] = [];

    // 1. Backend Fast Parse (Excel or CSV)
    if (fileName.endsWith(".csv")) {
      const text = buffer.toString("utf-8");
      const parsed = Papa.parse<Record<string, any>>(text, {
        header: true,
        skipEmptyLines: true,
      });
      rawRows = parsed.data;
    } else {
      const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(firstSheet, { defval: "" });
    }

    if (rawRows.length === 0) {
      return apiSuccess({
        totalParsed: 0,
        insertedCount: 0,
        duplicateCount: 0,
        failedCount: 0,
        durationMs: 0,
      });
    }

    // 2. Normalize and 3. Batch insert (delegated to shared lib)
    const vocab = await getRegionVocabulary(regionId);
    const { records, failedCount: normalizedFailed } = buildRecordsFromRows(rawRows, "GD-UPLOAD", {
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
        console.warn("[upload/route] Auto cluster trigger warning:", err?.message || err);
      });
    }

    const durationMs = Date.now() - startTime;

    return apiSuccess({
      totalParsed: rawRows.length,
      insertedCount,
      duplicateCount,
      failedCount,
      durationMs,
    });
  } catch (err: any) {
    console.error("Backend file upload error:", err);
    return apiError(ApiCode.FILE_UPLOAD_FAILED, err.message, 500);
  }
}
