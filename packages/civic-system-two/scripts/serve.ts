import { spawn } from 'node:child_process';
import fs from 'node:fs';

const MODEL_PATH =
  process.env.BONSAI_MODEL_PATH ||
  '/Users/FireTable/models/bonsai2-gguf/Ternary-Bonsai-2-27B-PTQ1_0.gguf';

const SERVER_BIN =
  process.env.LLAMA_SERVER_BIN ||
  '/Users/FireTable/prismml-llama/build/bin/llama-server';

const PORT = process.env.PORT || '8132';
const HOST = process.env.HOST || '127.0.0.1';

async function main() {
  if (!fs.existsSync(SERVER_BIN)) {
    console.error(`❌ 未找到 llama-server 可执行文件: ${SERVER_BIN}`);
    process.exit(1);
  }

  if (!fs.existsSync(MODEL_PATH)) {
    console.error(`❌ 未找到模型文件: ${MODEL_PATH}`);
    process.exit(1);
  }

  console.log('=== [System Two] 启动 Apple Silicon Metal 优化推理服务 ===');
  console.log(`模型: ${MODEL_PATH}`);
  console.log(`端口: ${HOST}:${PORT}`);
  console.log(`核心优化: -fa on, -ctk q8_0, -ctv q8_0, -np 1 (最佳三值吞吐)\n`);

  const args = [
    '-m', MODEL_PATH,
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
    '--reasoning-budget', '0',
    '--reasoning-format', 'none',
    '--chat-template-kwargs', '{"enable_thinking": false}'
  ];

  const proc = spawn(SERVER_BIN, args, {
    stdio: 'inherit',
    env: process.env,
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
