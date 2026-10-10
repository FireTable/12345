#!/usr/bin/env tsx
/**
 * Mac 本地双推理引擎一键常驻启动器 (Dual Inference Server Launcher)
 * 同时拉起:
 * 1. System-2 (Bonsai-2 27B 大模型，端口 8132)
 * 2. Civic-Embed (bge-m3 密集向量模型，端口 8133)
 *
 * 监听 0.0.0.0，供 VPS 通过 Tailscale 内网 (100.x.y.z) 跨机调用。
 * 支持 Ctrl+C 优雅退避，不留孤儿进程。
 */

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import nextEnvPkg from "@next/env";

const { loadEnvConfig } = (nextEnvPkg as any).default || nextEnvPkg;
if (loadEnvConfig) loadEnvConfig(process.cwd());

const S2_SCRIPT = path.resolve(process.cwd(), "packages/civic-system-two/scripts/serve.ts");
const EMBED_SCRIPT = path.resolve(process.cwd(), "packages/civic-embed/scripts/serve.ts");

console.log("==================================================================");
console.log("🚀 [CivicRadar] 启动 Mac 本地双推理算力常驻集群");
console.log("==================================================================");
console.log("  • System-2 (27B 慢思考大模型): http://0.0.0.0:8132/v1");
console.log("  • Civic-Embed (bge-m3 向量嵌入): http://0.0.0.0:8133/v1");
console.log("------------------------------------------------------------------");
console.log("💡 [Tailscale 跨机配置指引]:");
console.log("  1. 在 Mac 运行 `tailscale ip -4` 获取内网 IP (例如 100.88.99.100)");
console.log("  2. 在 VPS 的 .env.vps 中配置:");
console.log("     SYSTEM_TWO_ENDPOINTS=http://100.88.99.100:8132/v1");
console.log("     EMBEDDING_ENDPOINTS=local:http://100.88.99.100:8133/v1");
console.log("==================================================================\n");

const procs: ChildProcess[] = [];

// 1. 启动 System-2 27B
const s2Proc = spawn("npx", ["tsx", S2_SCRIPT], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: "8132",
    HOST: "0.0.0.0",
  },
});
procs.push(s2Proc);

// 2. 启动 Civic-Embed bge-m3
const embedProc = spawn("npx", ["tsx", EMBED_SCRIPT], {
  stdio: "inherit",
  env: {
    ...process.env,
    EMBED_PORT: "8133",
    EMBED_HOST: "0.0.0.0",
  },
});
procs.push(embedProc);

let isCleaningUp = false;
function cleanup() {
  if (isCleaningUp) return;
  isCleaningUp = true;
  console.log("\n🛑 正在停止本地推理集群...");
  for (const p of procs) {
    if (p.pid && !p.killed) {
      try {
        p.kill("SIGTERM");
      } catch {}
    }
  }
  setTimeout(() => {
    for (const p of procs) {
      if (p.pid && !p.killed) {
        try {
          p.kill("SIGKILL");
        } catch {}
      }
    }
    process.exit(0);
  }, 2000);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

s2Proc.on("exit", (code) => {
  if (!isCleaningUp) {
    console.warn(`⚠️ System-2 进程已退出 (code: ${code})`);
  }
});

embedProc.on("exit", (code) => {
  if (!isCleaningUp) {
    console.warn(`⚠️ Civic-Embed 进程已退出 (code: ${code})`);
  }
});
