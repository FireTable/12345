import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { buildRecordsFromRows, insertRecordsBatch } from "@/lib/ticket-ingest";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const regionId = await resolveRequestRegionId(req);
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ success: false, error: "未接收到上传文件" }, { status: 400 });
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
      return NextResponse.json({
        success: true,
        message: "表格为空",
        data: { totalParsed: 0, insertedCount: 0, duplicateCount: 0, failedCount: 0, durationMs: 0 },
      });
    }

    // 2. Normalize and 3. Batch insert (delegated to shared lib)
    const { records, failedCount: normalizedFailed } = buildRecordsFromRows(rawRows, "GD-UPLOAD");
    const { insertedCount, duplicateCount, failedCount: batchFailed } =
      await insertRecordsBatch(records, regionId);
    const failedCount = normalizedFailed + batchFailed;

    const durationMs = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      message: `后端处理完成: 共解析 ${rawRows.length} 条，入库 ${insertedCount} 条，重复过滤 ${duplicateCount} 条，异常 ${failedCount} 条`,
      data: {
        totalParsed: rawRows.length,
        insertedCount,
        duplicateCount,
        failedCount,
        durationMs,
      },
    });
  } catch (err: any) {
    console.error("Backend file upload error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "后端文件解析失败" },
      { status: 500 }
    );
  }
}
