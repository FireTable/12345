/**
 * 本机 bge-m3 嵌入服务。权重不在就不启动。
 * dev 检测到 8133 已开时不会再起一份。
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultWeightPath, weightFileNameIsF16 } from "./pull";

export const EMBED_DEV_PORT = 8133;
export const EMBED_DEV_HOST = "127.0.0.1";

export type EmbedDevAction = "reuse" | "start" | "skip";

export function embedDevAction(input: {
  portOpen: boolean;
  hasBin: boolean;
  hasModel: boolean;
}): EmbedDevAction {
  if (input.portOpen) return "reuse";
  if (input.hasBin && input.hasModel) return "start";
  return "skip";
}

/** 本机端点放在最前。已经写过的地址保留，云端仍作备用。 */
export function embedEndpointsWithLocal(localUrl: string, existing: string | undefined): string {
  const local = localUrl.replace(/\/+$/, "");
  const parts = (existing || "")
    .split(",")
    .map((item) => item.trim().replace(/\/+$/, ""))
    .filter(Boolean)
    .filter((item) => item !== local);
  return [local, ...parts].join(",");
}

export function embedServerArgs(modelPath: string, port = EMBED_DEV_PORT, host = EMBED_DEV_HOST): string[] {
  return [
    "-m", modelPath,
    "--embedding",
    "--alias", "BAAI/bge-m3",
    "--host", host,
    "--port", String(port),
    "-ngl", "99",
    "-c", "512",
    // -b/-ub 按 token 计。HTTP 一批 32 条；一条产物大约 50 token，ubatch 32 会被 llama 整批拒绝。
    "-b", "512",
    "-ub", "512",
    "-np", "1",
  ];
}

export function resolveEmbedModelPath(): string | null {
  const explicit = process.env.EMBED_MODEL_PATH?.trim();
  if (explicit && fs.existsSync(explicit) && weightFileNameIsF16(path.basename(explicit))) {
    return path.resolve(explicit);
  }
  const fallback = defaultWeightPath();
  if (fs.existsSync(fallback) && weightFileNameIsF16(path.basename(fallback))) return fallback;
  return null;
}

function resolveServerBin(): string | null {
  if (process.env.LLAMA_SERVER_BIN && fs.existsSync(process.env.LLAMA_SERVER_BIN)) {
    return path.resolve(process.env.LLAMA_SERVER_BIN);
  }
  const binName = process.platform === "win32" ? "llama-server.exe" : "llama-server";
  const candidates = [
    path.resolve(process.cwd(), "bin", binName),
    path.join(os.homedir(), "prismml-llama/build/bin/llama-server"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function main() {
  const modelPath = resolveEmbedModelPath();
  const serverBin = resolveServerBin();
  if (!serverBin) {
    console.error("未找到 llama-server。设置 LLAMA_SERVER_BIN 后再启动嵌入。");
    process.exit(1);
  }
  if (!modelPath) {
    console.error("未找到 bge-m3 F16 权重。先运行 pnpm embed:pull。");
    process.exit(1);
  }
  const port = process.env.EMBED_PORT || String(EMBED_DEV_PORT);
  const host = process.env.EMBED_HOST || EMBED_DEV_HOST;
  const args = embedServerArgs(modelPath, Number(port), host);
  console.log(`引擎: ${serverBin}`);
  console.log(`模型: ${modelPath}`);
  console.log(`绑定: http://${host}:${port}/v1`);
  const proc: ChildProcess = spawn(serverBin, args, { stdio: "inherit", env: process.env });
  const stop = () => {
    if (proc.pid && !proc.killed) proc.kill("SIGTERM");
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  proc.on("exit", (code) => process.exit(code || 0));
}

const startedAsCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (startedAsCli) main();
