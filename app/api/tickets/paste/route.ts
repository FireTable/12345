import { NextResponse } from "next/server";
import { buildRecordsFromTexts, insertRecordsBatch } from "@/lib/ticket-ingest";

const MAX_LINES = 2000;
const MAX_LINE_CHARS = 4000;

export async function POST(req: Request) {
  const startTime = Date.now();

  try {
    const body = await req.json().catch(() => null) as { texts?: unknown } | null;
    const rawTexts = Array.isArray(body?.texts) ? body!.texts : null;
    if (!rawTexts) {
      return NextResponse.json(
        { success: false, error: "请求体需要包含 texts: string[]" },
        { status: 400 }
      );
    }

    // ponytail: 每条纯文本做长度截断,避免一行塞进整份文件把 DB 字符串列撑爆。
    const texts = (rawTexts as unknown[])
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.slice(0, MAX_LINE_CHARS));

    if (texts.length === 0) {
      return NextResponse.json({
        success: true,
        message: "粘贴内容为空",
        data: { totalParsed: 0, insertedCount: 0, duplicateCount: 0, failedCount: 0, durationMs: 0 },
      });
    }
    if (texts.length > MAX_LINES) {
      return NextResponse.json(
        { success: false, error: `单次粘贴最多 ${MAX_LINES} 条,当前 ${texts.length} 条` },
        { status: 400 }
      );
    }

    const { records, failedCount: normalizedFailed } = buildRecordsFromTexts(texts);
    const { insertedCount, duplicateCount, failedCount: batchFailed } =
      await insertRecordsBatch(records);
    const failedCount = normalizedFailed + batchFailed;

    const durationMs = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      message: `粘贴入库完成: 共解析 ${texts.length} 条，入库 ${insertedCount} 条，重复过滤 ${duplicateCount} 条，异常 ${failedCount} 条`,
      data: {
        totalParsed: texts.length,
        insertedCount,
        duplicateCount,
        failedCount,
        durationMs,
      },
    });
  } catch (err: any) {
    console.error("Backend paste ingest error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "后端粘贴解析失败" },
      { status: 500 }
    );
  }
}
