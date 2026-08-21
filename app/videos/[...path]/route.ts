// app/videos/[...path]/route.ts
// ponytail: Next.js 15 standalone 不会从 public/ 直接 serve 大体积 mp4(已知 bug),
// 这里绕开静态层,fs 流式返回。Range / Cache / content-type 都打齐。

import fs from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
// 视/音频不参与构建期 prerender
export const dynamic = "force-dynamic";

const ALLOW_DIR = path.resolve(process.cwd(), "public", "videos");

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".ogv": "video/ogg",
  ".m4v": "video/x-m4v",
};

const mimeOf = (p: string) =>
  MIME[path.extname(p).toLowerCase()] ?? "application/octet-stream";

function badRange(size: number) {
  return new Response("Bad Range", {
    status: 416,
    headers: { "content-range": `bytes */${size}` },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;
  if (!segments?.length) return new Response("Not Found", { status: 404 });

  // 解码 + 安全拼接 + 防越狱
  const decoded = segments.map(decodeURIComponent).join("/");
  const filePath = path.resolve(ALLOW_DIR, decoded);
  if (filePath !== ALLOW_DIR && !filePath.startsWith(ALLOW_DIR + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }

  let st;
  try {
    st = await stat(filePath);
  } catch {
    return new Response("Not Found", { status: 404 });
  }
  if (!st.isFile()) return new Response("Not Found", { status: 404 });

  const size = st.size;
  const mime = mimeOf(filePath);
  const filename = path.basename(filePath);
  const range = req.headers.get("range");

  const baseHeaders = {
    "content-type": mime,
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=86400, immutable",
    "content-disposition": `inline; filename="${filename}"`,
  };

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) return badRange(size);
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Number(m[2]) : size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      return badRange(size);
    }
    const chunk = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });
    // ponytail: Readable.toWeb 把 Node stream 转 web stream;Next.js Route Handler 接受 web stream
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 206,
      headers: {
        ...baseHeaders,
        "content-range": `bytes ${start}-${end}/${size}`,
        "content-length": String(chunk),
      },
    });
  }

  const stream = fs.createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 200,
    headers: { ...baseHeaders, "content-length": String(size) },
  });
}
