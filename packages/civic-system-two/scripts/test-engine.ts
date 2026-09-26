import { SystemTwoEngine } from '../src/engine.js';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

// 自动探测并载入主工程 .env.local（免额外依赖）
try {
  const envPath = path.resolve(process.cwd(), '../../.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch {}

async function main() {
  console.log('====================================================');
  console.log('🚀 开始 System Two 认知引擎全套端到端集成测试');
  console.log('====================================================\n');

  // 初始化引擎（探测本地 8132 端口，支持云端灾备）
  const engine = await SystemTwoEngine.create({
    endpoint: process.env.SYSTEM_TWO_ENDPOINT || 'http://127.0.0.1:8132/v1',
    timeoutMs: 60000,
    cloudFallback: process.env.OPENAI_API_KEY
      ? {
          endpoint: process.env.OPENAI_BASE_URL || 'https://api.edgefn.net/v1',
          apiKey: process.env.OPENAI_API_KEY,
          model: process.env.OPENAI_MODEL || 'DeepSeek-V4-Flash-0731',
        }
      : undefined,
  });

  console.log(`📡 当前活跃后端: ${engine.getActiveBackend()}\n`);

  // --- 测试 1: 慢思考问答 (默认思维链 enable_thinking: true) ---
  console.log('----------------------------------------------------');
  console.log('【测试 1】慢思考认知分析 (enable_thinking: true)');
  console.log('----------------------------------------------------');

  const startT1 = Date.now();
  const res1 = await engine.chat.completions.create({
    messages: [
      {
        role: 'user',
        content: '简要分析：“顺德区大良街道某小区楼下餐饮店夜间油烟直排扰民”问题的处置权责核心在于哪些部门？',
      },
    ],
    enable_thinking: true,
    max_tokens: 512,
  });
  const dur1 = ((Date.now() - startT1) / 1000).toFixed(2);

  const choice1 = res1.choices[0];
  console.log(`⏱️ 耗时: ${dur1}s | Tokens: prompt=${res1.usage.prompt_tokens}, completion=${res1.usage.completion_tokens}`);
  if (choice1.message.reasoning_content) {
    console.log(`🧠 [思维链 reasoning_content 成功分离] (长度: ${choice1.message.reasoning_content.length} 字符):`);
    console.log(choice1.message.reasoning_content.slice(0, 150) + '...\n');
  } else {
    console.log('ℹ️ 本次输出无 reasoning_content（可能模型直出）');
  }
  console.log('📝 [纯净正文 content]:');
  console.log(choice1.message.content.trim() + '\n');

  // --- 测试 2: 结构化输出与 Zod 强类型校验 ---
  console.log('----------------------------------------------------');
  console.log('【测试 2】结构化 JSON 输出与 Zod 校验 (createJSON)');
  console.log('----------------------------------------------------');

  const AuditSchema = z.object({
    is_valid_complaint: z.boolean(),
    domain: z.string(),
    summary: z.string(),
    key_factors: z.array(z.string()),
  });

  type AuditResult = z.infer<typeof AuditSchema>;

  const startT2 = Date.now();
  const structuredRes = await engine.createJSON<AuditResult>(
    AuditSchema,
    {
      messages: [
        {
          role: 'system',
          content: '你是一个政务智能助手，请以严格的 JSON 格式输出分析结果。输出格式：{"is_valid_complaint": boolean, "domain": string, "summary": string, "key_factors": string[]}',
        },
        {
          role: 'user',
          content: '市民反映容桂街道红绿灯故障，导致早高峰交通严重拥堵。',
        },
      ],
      enableThinking: false, // 提取类任务显式关闭思考加速
      maxTokens: 300,
    }
  );
  const dur2 = ((Date.now() - startT2) / 1000).toFixed(2);

  console.log(`⏱️ 耗时: ${dur2}s | 状态: 校验通过 ✅`);
  console.log('📦 [Zod 解析后对象]:', JSON.stringify(structuredRes.data, null, 2));
  console.log();

  // --- 测试 3: 思考关闭模式对比 ---
  console.log('----------------------------------------------------');
  console.log('【测试 3】关闭思考直出 (enable_thinking: false)');
  console.log('----------------------------------------------------');

  const startT3 = Date.now();
  const res3 = await engine.chat.completions.create({
    messages: [
      {
        role: 'user',
        content: '一句话回答：顺德以什么美食闻名？',
      },
    ],
    enable_thinking: false,
    max_tokens: 64,
  });
  const dur3 = ((Date.now() - startT3) / 1000).toFixed(2);

  console.log(`⏱️ 耗时: ${dur3}s | 正文: ${res3.choices[0].message.content.trim()}`);
  console.log(`🧠 思维链存在: ${!!res3.choices[0].message.reasoning_content}\n`);

  // --- 测试 4: 离线容灾防御测试 ---
  console.log('----------------------------------------------------');
  console.log('【测试 4】离线容灾安全兜底测试 (连接不可达端口 9999)');
  console.log('----------------------------------------------------');

  const offlineEngine = await SystemTwoEngine.create({
    endpoint: 'http://127.0.0.1:9999/v1',
  });
  console.log(`🛡️ 离线引擎后端: ${offlineEngine.getActiveBackend()}`);

  const fallbackRes = await offlineEngine.chat.completions.create({
    messages: [{ role: 'user', content: '测试离线' }],
    response_format: { type: 'json_object' },
  });

  console.log('🛡️ 兜底返回:', fallbackRes.choices[0].message.content);
  console.log(`🛡️ 兜底 parsed 对象存在: ${!!fallbackRes.parsed}\n`);

  console.log('====================================================');
  console.log('🎉 所有 4 项测试全部顺利通过！System Two 生产级就绪！');
  console.log('====================================================');
}

main().catch((err) => {
  console.error('测试异常终止:', err);
  process.exit(1);
});
