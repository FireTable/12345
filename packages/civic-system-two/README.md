# @civic/system-two

**12345 慢思考通用认知大模型引擎 (Slow-Thinking Cognitive Engine)**

基于 Apple Silicon Metal 硬件深度调优的通用 LLM 慢思考推理运行时，100% 遵循 OpenAI Chat Completions 协议标准，具备思维链（CoT）与正文完全分离、调用方自由格式驱动、强类型结构化解析与多层自适应容灾降级能力。

---

## 核心设计特性

1. **100% 兼容 OpenAI 协议规范**：
   - 遵循 `engine.chat.completions.create({...})` 签名。
   - 完全支持 `messages`、`response_format`（`text` / `json_object` / `json_schema`）、`temperature`、`max_tokens` 等标准入参。
2. **思维链（CoT）与正文纯净分离**：
   - **默认开启慢思考 (`enable_thinking: true`)**，深入拆解复杂诉求权责与争议点。
   - 模型的思考过程自动剥离并置入 `choices[0].message.reasoning_content`，纯净答复置入 `choices[0].message.content`。
   - 调用方亦可随时显式指定 `enable_thinking: false` 关闭思考进行低延迟直出。
3. **格式完全由调用方掌控**：
   - 包内部**不硬编码**任何业务级 Prompt 或格式限制，业务层自由决定输出纯文本、Markdown 报告或 JSON 数据。
   - 提供 `engine.createJson<T>(params, schema)` 配合 Zod 实现带类型守卫的端到端安全解析。
4. **Apple Silicon Metal 黄金调优**：
   - 搭载 Bonsai 2 27B PTQ1_0 三值大模型（单量化权重仅 5.5GB）。
   - 实测最佳参数配置：单流高吞吐（`-np 1`，彻底避免多 Batch 导致的 Metal 三值去量化带宽竞争瓶颈）、Flash Attention 开启（`-fa on`）、KV Cache 压缩减半（`-ctk q8_0 -ctv q8_0`），在 M 系列芯片上实现稳定 20+ tokens/s。
5. **多层平滑灾备降级**：
   - 链路：`本地 Metal (llama-server:8132)` ➔ `远程兼容云端 (DeepSeek / OpenAI)` ➔ `离线安全兜底 (FallbackAdapter)`。

---

## 快速上手

### 1. 安装依赖与环境检查

```bash
cd packages/civic-system-two
pnpm install # 或 npm install

# 检查本地 GGUF 模型物料与推理引擎
npm run setup:model
```

### 2. 启动本地推理服务

```bash
# 启动调优参数的 llama-server (端口 8132)
npm run serve
```

### 3. 在 TypeScript 中调用

```typescript
import { SystemTwoEngine, z } from '@civic/system-two';

// 1. 初始化引擎（自动探测本地 8132 端口并自适应探测健康状态）
const engine = await SystemTwoEngine.create({
  endpoint: 'http://127.0.0.1:8132/v1',
  timeoutMs: 120000,
});

// 2. 标准问答（默认开启慢思考 enable_thinking: true）
const response = await engine.chat.completions.create({
  messages: [
    { role: 'user', content: '分析小区楼下餐饮夜间油烟直排扰民的部门管辖权限' }
  ],
  enable_thinking: true,
});

// 纯正文输出
console.log(response.choices[0].message.content);
// 慢思考思维链
console.log(response.choices[0].message.reasoning_content);

// 3. 结构化 JSON 输出与 Zod 强校验 (createJSON 显式传参)
const ResultSchema = z.object({
  department: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
  suggested_action: z.string(),
});

const result = await engine.createJSON(
  ResultSchema,
  {
    messages: [
      { role: 'system', content: '输出 JSON 格式的工单分派建议' },
      { role: 'user', content: '某路段交通信号灯损坏' },
    ],
    enableThinking: false, // 结构化抽取任务显式关闭思考加速直出
  }
);

console.log(result.data.department);
console.log(result.data.priority);
```

---

## 目录结构

```
packages/civic-system-two/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts                     # 统一导出
│   ├── types.ts                     # OpenAI 兼容入参出参与核心配置类型
│   ├── engine.ts                    # 引擎主入口、健康路由与 createJson 工具
│   ├── parser.ts                    # <think> 提取分离与 JSON Markdown 清洗器
│   └── adapters/
│       ├── types.ts                 # 适配器接口标准 (ISystemTwoAdapter)
│       ├── local-metal-adapter.ts   # 本地 Metal llama-server 适配器
│       ├── cloud-openai-adapter.ts   # 远程通用云端 OpenAI 适配器
│       └── fallback-adapter.ts       # 离线安全兜底适配器
└── scripts/
    ├── setup.ts                     # 环境与模型物料自检脚本
    ├── serve.ts                     # 最优 Metal 参数本地启动脚本
    └── test-engine.ts               # 端到端 4 项自动化集成测试套件
```

---

## 运行自动化测试

```bash
npm run test
```
