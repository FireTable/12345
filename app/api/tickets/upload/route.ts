import { NextRequest } from "next/server";
import { Readable } from "node:stream";
import busboy from "busboy";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { buildRecordsFromRows, insertRecordsBatch } from "@/lib/ticket-ingest";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { getRegionVocabulary } from "@/lib/vocabulary";
import { apiSuccess, apiError, ApiCode } from "@/lib/api-codes";
import { triggerClusterJobAuto } from "@/lib/cluster-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes for large files (e.g. 10w+ rows)

interface UploadedPayload {
  buffer: Buffer;
  fileName: string;
}

function sanitizeFileName(rawHeader: string | null): string {
  if (!rawHeader) return "upload.xlsx";
  let decoded = rawHeader;
  try {
    decoded = decodeURIComponent(rawHeader);
  } catch {
    decoded = rawHeader;
  }
  // If Content-Disposition was sent: attachment; filename="12345.xlsx"
  const match = decoded.match(/filename\*?=['"]?(?:UTF-\d['"]*)?([^;\r\n"']*)['"]?/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  return decoded.trim() || "upload.xlsx";
}

async function extractUploadedFile(req: NextRequest): Promise<UploadedPayload | null> {
  const contentType = (req.headers.get("content-type") || "").toLowerCase();

  // 1. Direct binary / octet-stream upload (fastest, zero multipart overhead, no filename encoding bugs)
  if (
    contentType.includes("application/octet-stream") ||
    contentType.includes("text/csv") ||
    contentType.includes("application/vnd.openxmlformats-officedocument") ||
    contentType.includes("application/vnd.ms-excel") ||
    !contentType.includes("multipart/form-data")
  ) {
    const rawHeader =
      req.headers.get("x-file-name") ||
      req.headers.get("x-filename") ||
      req.headers.get("content-disposition");
    const fileName = sanitizeFileName(rawHeader);

    const arrayBuffer = await req.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      return null;
    }
    return {
      buffer: Buffer.from(arrayBuffer),
      fileName,
    };
  }

  // 2. Multipart form data via busboy stream (prevents undici crash on large files or non-ASCII filenames)
  if (req.body) {
    try {
      const parsed = await new Promise<UploadedPayload | null>((resolve, reject) => {
        const bb = busboy({
          headers: {
            "content-type": req.headers.get("content-type") || "",
          },
          limits: {
            fileSize: 500 * 1024 * 1024, // 500MB
          },
        });

        let fileBuffer: Buffer | null = null;
        let fileName = "upload.xlsx";
        const chunks: Buffer[] = [];

        bb.on("file", (_fieldName, stream, info) => {
          fileName = info.filename || fileName;
          stream.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          stream.on("end", () => {
            fileBuffer = Buffer.concat(chunks);
          });
        });

        bb.on("finish", () => {
          if (fileBuffer && fileBuffer.length > 0) {
            resolve({ buffer: fileBuffer, fileName });
          } else {
            resolve(null);
          }
        });

        bb.on("error", (err) => {
          reject(err);
        });

        const nodeReadable = Readable.fromWeb(req.body as any);
        nodeReadable.pipe(bb);
      });

      if (parsed) {
        return parsed;
      }
    } catch (bbErr) {
      console.warn("[upload/route] Busboy stream parsing failed, trying formData fallback:", bbErr);
    }
  }

  // 3. Fallback to standard req.formData()
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return null;
    const arrayBuffer = await file.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      fileName: file.name,
    };
  } catch (fdErr) {
    console.error("[upload/route] FormData fallback also failed:", fdErr);
    throw fdErr;
  }
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const regionId = await resolveRequestRegionId(req);
    const uploaded = await extractUploadedFile(req);

    if (!uploaded || !uploaded.buffer || uploaded.buffer.length === 0) {
      return apiError(ApiCode.FILE_EMPTY, "上传文件为空或解析失败", 400);
    }

    const { buffer, fileName } = uploaded;
    const lowerName = fileName.toLowerCase();

    let rawRows: Record<string, any>[] = [];

    // 1. Backend Fast Parse (Excel or CSV)
    if (lowerName.endsWith(".csv")) {
      let text = "";
      try {
        const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
        text = utf8Decoder.decode(buffer);
      } catch {
        // Fallback to GB18030 for Chinese government 12345 hotline CSV exports
        try {
          const gbkDecoder = new TextDecoder("gb18030");
          text = gbkDecoder.decode(buffer);
        } catch {
          text = buffer.toString("utf-8");
        }
      }

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
