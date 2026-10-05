import { NextRequest } from "next/server";
import { Readable } from "node:stream";
import busboy from "busboy";
import AdmZip from "adm-zip";
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
    contentType.includes("application/zip") ||
    contentType.includes("application/x-zip-compressed") ||
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

function parseCsvBuffer(buffer: Buffer): Record<string, any>[] {
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
  return parsed.data || [];
}

function parseSingleDataBuffer(buffer: Buffer, fileName: string): Record<string, any>[] {
  const lowerName = fileName.toLowerCase();

  // If CSV
  if (lowerName.endsWith(".csv")) {
    return parseCsvBuffer(buffer);
  }

  const isZip =
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04;

  // Try XLSX
  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json<Record<string, any>>(firstSheet, { defval: "" });
  } catch (xlsxErr: any) {
    console.warn(`[upload/route] XLSX.read failed for "${fileName}":`, xlsxErr?.message);
    // 仅在明确不是 ZIP / XLSX 二进制包时才尝试 CSV 容错兜底，绝不把二进制字节流当作 CSV 解析
    if (!isZip && !lowerName.endsWith(".xlsx") && !lowerName.endsWith(".xls")) {
      try {
        const csvRows = parseCsvBuffer(buffer);
        if (csvRows.length > 0 && Object.keys(csvRows[0] || {}).length > 1) {
          return csvRows;
        }
      } catch {
        // ignore
      }
    }
    throw new Error(
      `Excel 表格解析失败 (${xlsxErr?.message || "文件损坏或格式不支持"})。请检查文件是否完整（大文件可能因网络或服务器传输限制被截断）。`
    );
  }
}

function parseUploadedBuffer(buffer: Buffer, fileName: string): Record<string, any>[] {
  const isZip =
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04;

  if (isZip) {
    try {
      const zip = new AdmZip(buffer);
      const entries = zip.getEntries();

      // Check if this is a direct XLSX file (has [Content_Types].xml or xl/workbook.xml)
      const isDirectXlsx = entries.some((e) => {
        const n = e.entryName.toLowerCase();
        return n === "[content_types].xml" || n === "xl/workbook.xml";
      });

      if (isDirectXlsx) {
        try {
          return parseSingleDataBuffer(buffer, fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`);
        } catch (directErr: any) {
          console.warn("[upload/route] Direct XLSX read failed, attempting re-packed buffer:", directErr?.message);
          try {
            // Re-pack clean buffer using AdmZip to resolve ZIP64 or alignment issues
            const cleanBuf = zip.toBuffer();
            return parseSingleDataBuffer(cleanBuf, "clean.xlsx");
          } catch (repackErr: any) {
            console.warn("[upload/route] Repack parse also failed:", repackErr?.message);
          }
        }
      }

      // If it's a ZIP archive containing files (e.g. data.csv, data.xlsx, or folders inside the zip):
      console.log(`[upload/route] Inspecting ZIP archive "${fileName}" (${entries.length} entries)...`);
      const validEntries = entries.filter((e) => {
        if (e.isDirectory) return false;
        const name = e.entryName.toLowerCase();
        if (name.includes("__macosx") || e.name.startsWith(".")) return false;
        return name.endsWith(".csv") || name.endsWith(".xlsx") || name.endsWith(".xls");
      });

      if (validEntries.length > 0) {
        let allRows: Record<string, any>[] = [];
        for (const entry of validEntries) {
          console.log(`[upload/route] Unpacking internal entry: ${entry.entryName} (${entry.header.size} bytes)`);
          const entryBuffer = entry.getData();
          const rows = parseSingleDataBuffer(entryBuffer, entry.name || entry.entryName);
          allRows = allRows.concat(rows);
        }
        return allRows;
      } else {
        // If no .csv/.xlsx/.xls entry was found by extension, check if any internal file is readable as CSV
        const textEntries = entries.filter(
          (e) => !e.isDirectory && !e.entryName.toLowerCase().includes("__macosx") && !e.name.startsWith(".")
        );
        for (const entry of textEntries) {
          try {
            const entryBuffer = entry.getData();
            const rows = parseCsvBuffer(entryBuffer);
            if (rows.length > 0 && Object.keys(rows[0] || {}).length > 1) {
              console.log(`[upload/route] Unpacked text entry as CSV: ${entry.entryName} (${rows.length} rows)`);
              return rows;
            }
          } catch {
            // try next
          }
        }
      }
    } catch (zipErr) {
      console.warn("[upload/route] AdmZip parsing failed, falling back to direct parse:", zipErr);
    }
  }

  // Not a zip, or fallback to single buffer parse
  return parseSingleDataBuffer(buffer, fileName);
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
    console.log(`[upload/route] Received file "${fileName}", size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

    const rawRows = parseUploadedBuffer(buffer, fileName);

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
