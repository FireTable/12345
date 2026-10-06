import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isWin = process.platform === 'win32';

/**
 * 自动定位 llama-server 可执行文件 (跨平台: Win / Mac / Linux)
 */
function resolveServerBin(): string | null {
  // 1. 用户显式指定环境变量
  if (process.env.LLAMA_SERVER_BIN && fs.existsSync(process.env.LLAMA_SERVER_BIN)) {
    return path.resolve(process.env.LLAMA_SERVER_BIN);
  }

  const binName = isWin ? 'llama-server.exe' : 'llama-server';

  // 2. 检查包内置或工作区 bin/ 目录
  const candidates = [
    path.resolve(__dirname, '..', 'bin', binName),
    path.resolve(process.cwd(), 'bin', binName),
    path.resolve(__dirname, '..', binName),
    path.resolve(process.cwd(), binName),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // 3. 检查系统 PATH
  const pathExt = isWin ? (process.env.PATHEXT || '.EXE;.BAT;.CMD').split(';') : [''];
  const envPaths = (process.env.PATH || '').split(path.delimiter);
  for (const p of envPaths) {
    for (const ext of pathExt) {
      const target = path.join(p, isWin ? `llama-server${ext}` : 'llama-server');
      if (fs.existsSync(target)) return target;
    }
  }

  // 4. macOS 开发者默认本地路径
  if (!isWin) {
    const macDefault = '/Users/FireTable/prismml-llama/build/bin/llama-server';
    if (fs.existsSync(macDefault)) return macDefault;
  }

  return null;
}

/**
 * 自动定位 Bonsai GGUF 模型文件 (跨平台)
 */
function resolveModelPath(): string | null {
  // 1. 用户显式指定环境变量
  if (process.env.BONSAI_MODEL_PATH && fs.existsSync(process.env.BONSAI_MODEL_PATH)) {
    return path.resolve(process.env.BONSAI_MODEL_PATH);
  }

  // 2. 自动搜索 models/ 目录下的 *.gguf
  const searchDirs = [
    path.resolve(__dirname, '..', 'models'),
    path.resolve(process.cwd(), 'models'),
    path.resolve(process.cwd(), '..', 'models'),
  ];

  for (const dir of searchDirs) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      const gguf = files.find((f) => f.toLowerCase().endsWith('.gguf'));
      if (gguf) return path.join(dir, gguf);
    }
  }

  // 3. macOS 开发者默认本地路径
  if (!isWin) {
    const macDefault = '/Users/FireTable/models/bonsai2-gguf/Ternary-Bonsai-2-27B-PTQ1_0.gguf';
    if (fs.existsSync(macDefault)) return macDefault;
  }

  return null;
}

const PORT = process.env.PORT || '8132';
// 默认监听 0.0.0.0，使无论是 Mac 还是 Windows，启动后局域网其它机器均可直接通信
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  const serverBin = resolveServerBin();
  const modelPath = resolveModelPath();

  if (!serverBin) {
    console.error(`❌ 未找到 llama-server 可执行文件！`);
    if (isWin) {
      console.log(`\n【Windows 傻瓜指引】:`);
      console.log(`  请从 PrismML llama.cpp Release 下载 Windows 版本的 llama-server.exe`);
      console.log(`  并将其放入 packages/civic-system-two/bin/llama-server.exe 即可！\n`);
    } else {
      console.log(`  请设置环境变量 LLAMA_SERVER_BIN 或将 llama-server 放入 bin/ 目录。\n`);
    }
    process.exit(1);
  }

  if (!modelPath) {
    console.error(`❌ 未找到 GGUF 模型文件！`);
    console.log(`\n【模型放置指引】:`);
    console.log(`  请将 Ternary-Bonsai-2-27B 模型文件放入 packages/civic-system-two/models/ 目录`);
    console.log(`  或设置环境变量 BONSAI_MODEL_PATH 指向模型完整路径。\n`);
    process.exit(1);
  }

  const platformName = isWin ? 'Windows (CUDA/DirectX)' : 'Apple Silicon (Metal)';
  console.log(`=== [System Two] 启动 ${platformName} 优化推理服务 ===`);
  console.log(`引擎: ${serverBin}`);
  console.log(`模型: ${modelPath}`);
  console.log(`绑定: ${HOST}:${PORT} (局域网已可达)`);
  console.log(`优化: -fa on, -ctk q8_0, -ctv q8_0, -np 1 (最佳三值吞吐)\n`);

  const args = [
    '-m', modelPath,
    '--alias', 'bonsai-2-27b',
    '-ngl', '99',
    '--port', PORT,
    '--host', HOST,
    '--ctx-size', '8192',
    '-fa', 'on',
    '-ctk', 'q8_0',
    '-ctv', 'q8_0',
    '-np', '1',
    '--batch-size', '1024',
    '--ubatch-size', '256',
  ];

  const proc = spawn(serverBin, args, {
    stdio: 'inherit',
    env: process.env,
    shell: isWin,
  });

  proc.on('error', (err) => {
    console.error('启动失败:', err);
  });

  proc.on('exit', (code) => {
    console.log(`llama-server 已退出 (code: ${code})`);
    process.exit(code || 0);
  });

  process.on('SIGINT', () => {
    console.log('\n接收到中断信号，正在关闭 llama-server...');
    proc.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    proc.kill('SIGTERM');
  });
}

main().catch(console.error);
