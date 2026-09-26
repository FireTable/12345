import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_MODEL_PATH =
  process.env.BONSAI_MODEL_PATH ||
  '/Users/FireTable/models/bonsai2-gguf/Ternary-Bonsai-2-27B-PTQ1_0.gguf';

const DEFAULT_SERVER_BIN =
  process.env.LLAMA_SERVER_BIN ||
  '/Users/FireTable/prismml-llama/build/bin/llama-server';

async function main() {
  console.log('=== [System Two] 环境与模型物料自检 ===\n');

  let allOk = true;

  // 1. 检查 llama-server 二进制
  console.log(`[1/2] 检查推理引擎: ${DEFAULT_SERVER_BIN}`);
  if (fs.existsSync(DEFAULT_SERVER_BIN)) {
    console.log('  ✅ 推理引擎二进制已就绪\n');
  } else {
    console.warn('  ⚠️ 未在默认路径找到 llama-server。如果已加入 PATH，可忽略此提示。');
    console.log('  提示: 可以设置环境变量 LLAMA_SERVER_BIN 指定可执行文件。\n');
  }

  // 2. 检查 GGUF 模型物料
  console.log(`[2/2] 检查三值慢思考模型物料: ${DEFAULT_MODEL_PATH}`);
  if (fs.existsSync(DEFAULT_MODEL_PATH)) {
    const stat = fs.statSync(DEFAULT_MODEL_PATH);
    const sizeGb = (stat.size / (1024 * 1024 * 1024)).toFixed(2);
    console.log(`  ✅ 模型物料已就绪 (文件大小: ${sizeGb} GB)\n`);
  } else {
    allOk = false;
    console.error('  ❌ 未找到三值 Bonsai 2 27B PTQ1_0 模型文件！');
    console.log('\n请执行以下命令下载或放置模型:');
    console.log('  mkdir -p /Users/FireTable/models/bonsai2-gguf');
    console.log('  # 从 HuggingFace / ModelScope 下载 Ternary-Bonsai-2-27B-PTQ1_0.gguf');
    console.log('  # 或设置 BONSAI_MODEL_PATH 指向已有 GGUF 文件\n');
  }

  if (allOk) {
    console.log('🎉 验证全部通过！可运行 npm run serve 或 tsx scripts/serve.ts 启动服务。');
  } else {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('执行出错:', err);
  process.exit(1);
});
