/**
 * 可选：把 BAAI/bge-m3 的 F16 GGUF 下载到本机。
 * 不启动 llama-server，也不改正在跑的 27B。
 *
 *   pnpm embed:pull
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

export const EMBED_WEIGHT_FILE = "bge-m3-F16.gguf";
export const EMBED_WEIGHT_URL =
  "https://huggingface.co/lm-kit/bge-m3-gguf/resolve/main/bge-m3-F16.gguf";
export const EMBED_WEIGHT_BYTES = 1_157_671_200;
export const EMBED_WEIGHT_SHA256 =
  "daec91ffb5dd0c27411bd71f29932917c49cf529a641d0168496c3a501e3062c";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function weightFileNameIsF16(fileName: string): boolean {
  const name = fileName.toLowerCase();
  return name.includes("f16") && !/q[0-8]/.test(name);
}

export function weightFileStatus(
  size: number | null,
  sha256: string | null
): "missing" | "ready" | "incomplete" | "mismatch" {
  if (size == null) return "missing";
  if (size === EMBED_WEIGHT_BYTES && sha256 === EMBED_WEIGHT_SHA256) return "ready";
  if (size < EMBED_WEIGHT_BYTES) return "incomplete";
  return "mismatch";
}

export function defaultWeightPath(): string {
  const dir = process.env.EMBED_MODEL_DIR?.trim() || path.join(packageDir, "models");
  return path.join(dir, EMBED_WEIGHT_FILE);
}

async function sha256Of(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const { createReadStream } = await import("node:fs");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

async function fileSize(filePath: string): Promise<number | null> {
  try {
    const info = await stat(filePath);
    return info.size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function download(dest: string): Promise<void> {
  const partial = `${dest}.partial`;
  await rm(partial, { force: true });
  const response = await fetch(EMBED_WEIGHT_URL, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`下载失败 HTTP ${response.status}`);
  }
  const advertised = Number(response.headers.get("content-length") || "0");
  if (advertised !== EMBED_WEIGHT_BYTES) {
    throw new Error(`远端大小 ${advertised} 不是 F16 的 ${EMBED_WEIGHT_BYTES} 字节`);
  }
  const hash = createHash("sha256");
  let received = 0;
  let nextMark = EMBED_WEIGHT_BYTES / 10;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      received += chunk.length;
      if (received >= nextMark) {
        const percent = Math.min(100, Math.floor((received / EMBED_WEIGHT_BYTES) * 100));
        console.log(`下载中 ${percent}%`);
        nextMark += EMBED_WEIGHT_BYTES / 10;
      }
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body as any), counter, createWriteStream(partial));
  const digest = hash.digest("hex");
  if (received !== EMBED_WEIGHT_BYTES || digest !== EMBED_WEIGHT_SHA256) {
    await rm(partial, { force: true });
    throw new Error("下载内容和 F16 校验不一致，已删掉半截文件");
  }
  await rename(partial, dest);
}

async function main() {
  if (!weightFileNameIsF16(EMBED_WEIGHT_FILE)) {
    throw new Error("只允许下载 F16 权重");
  }
  const dest = defaultWeightPath();
  await mkdir(path.dirname(dest), { recursive: true });
  const size = await fileSize(dest);
  const digest = size === EMBED_WEIGHT_BYTES ? await sha256Of(dest) : null;
  const status = weightFileStatus(size, digest);
  if (status === "ready") {
    console.log(`权重已在 ${dest}`);
    return;
  }
  if (status === "mismatch") {
    throw new Error(`${dest} 已有文件，但不是这份 F16。换一个 EMBED_MODEL_DIR，或先移走该文件。`);
  }
  console.log(`开始下载 BAAI/bge-m3 F16 到 ${dest}`);
  await download(dest);
  console.log(`权重已在 ${dest}`);
  console.log("这条命令不启动 llama-server。27B 占着 GPU 时不要再把 bge-m3 铺上去。");
}

const startedAsCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (startedAsCli) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
