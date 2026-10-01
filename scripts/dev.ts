import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const PORT = 8132;
const HOST = "127.0.0.1";

const MODEL_PATH =
  process.env.BONSAI_MODEL_PATH ||
  "/Users/FireTable/models/bonsai2-gguf/Ternary-Bonsai-2-27B-PTQ1_0.gguf";

const SERVER_BIN =
  process.env.LLAMA_SERVER_BIN ||
  "/Users/FireTable/prismml-llama/build/bin/llama-server";

const SERVE_SCRIPT = path.resolve(
  process.cwd(),
  "packages/civic-system-two/scripts/serve.ts"
);

function startClusterWorker() {
  console.log("📋 [Queue] 启动研判队列进程（与 Next 分开，刷新页面不会打断任务）...");
  const workerProc = spawn("npx", ["tsx", "scripts/cluster-worker.ts"], {
    stdio: "inherit",
    env: process.env,
  });
  childProcesses.push(workerProc);
  workerProc.on("exit", (code, signal) => {
    const idx = childProcesses.indexOf(workerProc);
    if (idx >= 0) childProcesses.splice(idx, 1);
    if (shuttingDown) return;
    console.warn(
      `⚠️ [Queue] 研判队列退出 (${signal || `code ${code}`})，3 秒后重新拉起。未完成的任务会接着做`
    );
    setTimeout(() => {
      if (!shuttingDown) startClusterWorker();
    }, 3000);
  });
}

function checkPortInUse(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

async function waitForPort(
  port: number,
  host: string,
  timeoutMs = 15000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkPortInUse(port, host)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const childProcesses: ChildProcess[] = [];
let shuttingDown = false;

function cleanUpAndExit(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n🛑 正在停止全栈服务 (Next.js & System-2)...");
  for (const proc of childProcesses) {
    if (proc && !proc.killed && proc.pid) {
      try {
        proc.kill("SIGTERM");
      } catch {}
    }
  }
  setTimeout(() => process.exit(code), 200);
}

process.on("SIGINT", () => cleanUpAndExit(0));
process.on("SIGTERM", () => cleanUpAndExit(0));
process.on("exit", () => cleanUpAndExit(0));

async function main() {
  console.log("================================================================================");
  console.log("🚀 [12345 Dev Runner] 启动全栈开发环境：Next.js + System-2 慢思考引擎");
  console.log("================================================================================\n");

  const portInUse = await checkPortInUse(PORT, HOST);

  if (portInUse) {
    console.log(`✅ [System-2] 检测到本地 llama-server 已在 ${HOST}:${PORT} 运行，自动复用既有服务！`);
  } else {
    // 检查模型和二进制是否存在
    const hasBin = fs.existsSync(SERVER_BIN);
    const hasModel = fs.existsSync(MODEL_PATH);

    if (hasBin && hasModel) {
      console.log(`🧠 [System-2] 正在启动 Apple Silicon Metal 优化推理服务...`);
      console.log(`   模型: ${path.basename(MODEL_PATH)}`);
      console.log(`   端点: http://${HOST}:${PORT}/v1\n`);

      const s2Proc = spawn("npx", ["tsx", SERVE_SCRIPT], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PORT: String(PORT),
          HOST,
          BONSAI_MODEL_PATH: MODEL_PATH,
          LLAMA_SERVER_BIN: SERVER_BIN,
        },
      });

      childProcesses.push(s2Proc);

      // 输出部分服务关键日志
      s2Proc.stdout?.on("data", (data: Buffer) => {
        const line = data.toString();
        if (
          line.includes("HTTP server listening") ||
          line.includes("llama-server") ||
          line.includes("main: model loaded")
        ) {
          process.stdout.write(`   [System-2] ${line.trim()}\n`);
        }
      });

      s2Proc.stderr?.on("data", (data: Buffer) => {
        const line = data.toString();
        if (
          line.includes("error") ||
          line.includes("failed") ||
          line.includes("warning")
        ) {
          process.stderr.write(`   [System-2] ${line.trim()}\n`);
        }
      });

      s2Proc.on("error", (err) => {
        console.warn(`⚠️ [System-2] 启动异常: ${err.message}，将自动切换至云端 API 灾备模式。`);
      });

      s2Proc.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          console.warn(`⚠️ [System-2] 进程退出 (code ${code})，应用将自动走云端 API 兜底。`);
        }
      });

      // 异步检测端口就绪
      waitForPort(PORT, HOST, 10000).then((ready) => {
        if (ready) {
          console.log(`\n🎉 [System-2] 本地慢思考推理服务就绪！(http://${HOST}:${PORT}/v1)\n`);
        } else {
          console.log(`\n⏳ [System-2] 模型正在加载进 GPU 显存，稍后自动接管请求...\n`);
        }
      });
    } else {
      console.log(`⚠️ [System-2] 未找到本地模型 (${MODEL_PATH})，已启用云端 API 灾备直连模式。`);
    }
  }

  startClusterWorker();

  // 启动 Next.js 开发服务器
  console.log("🌐 [Next.js] 正在启动前端与 API 开发服务器 (端口 3000)...");
  const nextArgs = ["next", "dev"];
  if (process.argv.includes("-p") || process.argv.includes("--port")) {
    const pIdx = Math.max(
      process.argv.indexOf("-p"),
      process.argv.indexOf("--port")
    );
    if (process.argv[pIdx + 1]) {
      nextArgs.push("-p", process.argv[pIdx + 1]);
    }
  }

  const nextProc = spawn("npx", nextArgs, {
    stdio: "inherit",
    env: process.env,
  });

  childProcesses.push(nextProc);

  nextProc.on("error", (err) => {
    console.error("❌ Next.js 启动失败:", err);
    cleanUpAndExit(1);
  });

  nextProc.on("exit", (code) => {
    cleanUpAndExit(code || 0);
  });
}

main().catch((err) => {
  console.error("Fatal error starting dev environment:", err);
  cleanUpAndExit(1);
});
