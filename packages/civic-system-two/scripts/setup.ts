import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isWin = process.platform === 'win32';

function resolveServerBin(): string | null {
  if (process.env.LLAMA_SERVER_BIN && fs.existsSync(process.env.LLAMA_SERVER_BIN)) {
    return path.resolve(process.env.LLAMA_SERVER_BIN);
  }

  const binName = isWin ? 'llama-server.exe' : 'llama-server';
  const candidates = [
    path.resolve(__dirname, '..', 'bin', binName),
    path.resolve(process.cwd(), 'bin', binName),
    path.resolve(__dirname, '..', binName),
    path.resolve(process.cwd(), binName),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  const pathExt = isWin ? (process.env.PATHEXT || '.EXE;.BAT;.CMD').split(';') : [''];
  const envPaths = (process.env.PATH || '').split(path.delimiter);
  for (const p of envPaths) {
    for (const ext of pathExt) {
      const target = path.join(p, isWin ? `llama-server${ext}` : 'llama-server');
      if (fs.existsSync(target)) return target;
    }
  }

  if (!isWin) {
    const macDefault = path.join(os.homedir(), 'prismml-llama/build/bin/llama-server');
    if (fs.existsSync(macDefault)) return macDefault;
  }

  return null;
}

function resolveModelPath(): string | null {
  if (process.env.BONSAI_MODEL_PATH && fs.existsSync(process.env.BONSAI_MODEL_PATH)) {
    return path.resolve(process.env.BONSAI_MODEL_PATH);
  }

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

  if (!isWin) {
    const macDefault = path.join(os.homedir(), 'models/bonsai2-gguf/Ternary-Bonsai-2-27B-PTQ1_0.gguf');
    if (fs.existsSync(macDefault)) return macDefault;
  }

  return null;
}

async function main() {
  console.log(`=== [System Two] 环境与模型自检 (平台: ${isWin ? 'Windows' : 'macOS/Linux'}) ===\n`);

  let allOk = true;

  // 1. 检查 llama-server 二进制
  const serverBin = resolveServerBin();
  console.log(`[1/2] 检查推理引擎二进制:`);
  if (serverBin) {
    console.log(`  ✅ 推理引擎已就绪: ${serverBin}\n`);
  } else {
    allOk = false;
    const binName = isWin ? 'llama-server.exe' : 'llama-server';
    console.error(`  ❌ 未找到 ${binName}`);
    console.log(`  【极简配置】: 直接将 ${binName} 拷贝放入 packages/civic-system-two/bin/ 目录即可。\n`);
  }

  // 2. 检查 GGUF 模型物料
  const modelPath = resolveModelPath();
  console.log(`[2/2] 检查三值慢思考模型物料:`);
  if (modelPath) {
    const stat = fs.statSync(modelPath);
    const sizeGb = (stat.size / (1024 * 1024 * 1024)).toFixed(2);
    console.log(`  ✅ 模型物料已就绪: ${modelPath} (${sizeGb} GB)\n`);
  } else {
    allOk = false;
    console.error(`  ❌ 未找到 Ternary-Bonsai GGUF 模型文件！`);
    console.log(`  【极简配置】: 直接将 .gguf 模型文件丢进 packages/civic-system-two/models/ 目录即可。\n`);
  }

  if (allOk) {
    console.log('🎉 验证全部通过！可运行 npm run serve 一键启动推理服务。');
  } else {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('执行出错:', err);
  process.exit(1);
});
