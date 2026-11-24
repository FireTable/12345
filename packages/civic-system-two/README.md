# @civic/system-two

**12345 慢思考通用认知大模型引擎 (Slow-Thinking Cognitive Engine)**

基于 Apple Silicon Metal 硬件深度调优并支持远程 GPU（Colab / Linux）热挂载与云端灾备的通用 LLM 慢思考推理运行时。100% 遵循 OpenAI Chat Completions 协议标准，具备流式输出、思维链（CoT）与正文完全分离、强类型 Zod 结构化解析、多节点算力池自愈切回与云端末公里 PII 脱敏防护能力。

---

## 核心设计特性

1. **100% 兼容 OpenAI 协议与流式响应**：
   - 支持非流式 `engine.chat.completions.create({...})` 与流式 `engine.chat.completions.createStream({...})`；
   - 完整支持 `messages`、`response_format`（`text` / `json_object` / `json_schema`）、`temperature`、`max_tokens` 与标准 `AbortSignal` 取消传播（`createAbortError` / `linkAbortSignals`）。
2. **思维链（CoT）与正文纯净分离**：
   - 引擎默认支持慢思考（`enable_thinking: true`），思考过程自动剥离至 `choices[0].message.reasoning_content`（流式为 `deltaReasoning`），纯净正文直出至 `choices[0].message.content`（流式为 `deltaContent`）；
   - 调用方可显式传 `enable_thinking: false` / `enableThinking: false` 关闭思考实现低延迟结构化直出（主仓库的工单四要素抽取、主题建议与 `LightCopilot` 均显式关闭思考，避免输出配额被 CoT 占满）。
3. **强类型结构化解析 (`createJSON<T>`)**：
   - 包内部不硬编码业务 Prompt，提供 `engine.createJSON<T>(schema, options)` 配合 Zod 完成 JSON 清洗、反序列化与类型守卫，并返回实际命中的 `endpoint`、`usage` 与 `timings`。
4. **Apple Silicon Metal 调优与异构多节点算力池**：
   - 本地默认搭载 Bonsai 2 27B PTQ1_0 三值大模型（5.5GB 权重），黄金参数 `-np 1 -fa on -ctk q8_0 -ctv q8_0` 在 M 系列芯片稳定输出 **20 ~ 24 tokens/s**；
   - 支持通过 `nodes: ClusterNodeSpec[]` 为每个节点独立配置 `endpoint`、`apiKey`、`model`、`provider`（`LOCAL` / `COLAB` / `CLOUD`）与 `name`，无缝承载本地 Metal 集群与 [`scripts/colab`](../../scripts/colab/README.md) 热挂载的远程 GPU 节点；
   - 内置每节点最近 8 条工单预览环形缓冲（`ENDPOINT_TICKETS_MAX = 8`），供 AI 研判工作台按节点可视化监控。
5. **三层容灾降级、繁忙直通与自愈切回**：
   - 链路：`多节点算力池 (PooledMetalAdapter)` ➔ `远程兼容云端 (CloudOpenAIAdapter)` ➔ `离线安全兜底 (FallbackAdapter)`；
   - `PooledMetalAdapter` 按轮询游标 + 在途请求数 + 连续失败次数选点，不健康节点超过 3 秒再探复原；
   - 流式交互支持 `localWaitTimeoutMs`（首包等待超时无损切云端，不误标节点不健康）、`preferCloudWhenLocalBusy`（本地集群满载时避免交互请求被批处理饿死）与 `preferCloudDirect`；
   - 处于降级态时按冷却窗口（默认 30s，可通过 `SYSTEM_TWO_SWITCHBACK_COOLDOWN_MS` 配置）单飞探活本地集群，恢复后自动切回。
6. **云端末公里 PII 脱敏防护 (`scrubCloudPiiText`)**：
   - `CloudOpenAIAdapter` 在任何非 `system` 消息发往外部云端端点前自动执行 `scrubCloudPiiText`，将漏网的身份证号、银行卡号、手机号、带区号固话与电子邮箱替换为 `{{ID_CARD_CLOUD}}` / `{{BANK_CARD_CLOUD}}` / `{{PHONE_NUMBER_CLOUD}}` / `{{EMAIL_CLOUD}}`，构成三层出网 PII 防火墙的最后一道防线。
7. **统一秒级耗时统计**：
   - 优先记录 llama 返回的 `predicted_ms`（纯生成），缺失时回退 `prompt_ms + predicted_ms` 或墙钟时间；`formatDuration` 一律格式化为秒（如 `0.4s`、`1.9s`）。

---

## 快速上手

### 1. 安装依赖与环境检查

```bash
cd packages/civic-system-two
pnpm install

# 检查本地 GGUF 模型物料与推理引擎
pnpm run setup:model
```

### 2. 启动本地推理服务

```bash
# 启动调优参数的 llama-server (端口 8132)
pnpm run serve
```

### 3. 在 TypeScript 中调用

```typescript
import { SystemTwoEngine, z } from "@civic/system-two";

// 1. 初始化引擎（支持单端点、多端点或含独立密钥的异构节点数组）
const engine = await SystemTwoEngine.create({
  nodes: [
    { endpoint: "http://127.0.0.1:8132/v1", provider: "LOCAL", name: "Mac Metal 27B" },
  ],
  timeoutMs: 120_000,
});

// 2. 流式对话（支持首包超时切云端与本地繁忙避让）
for await (const chunk of engine.chat.completions.createStream({
  messages: [{ role: "user", content: "生成当前辖区高风险多频主题研判摘要" }],
  enable_thinking: false,
  localWaitTimeoutMs: 6_000,
  preferCloudWhenLocalBusy: true,
})) {
  if (chunk.deltaContent) process.stdout.write(chunk.deltaContent);
}

// 3. 结构化 JSON 输出与 Zod 强校验
const ResultSchema = z.object({
  department: z.string(),
  priority: z.enum(["high", "medium", "low"]),
  suggested_action: z.string(),
});

const result = await engine.createJSON(ResultSchema, {
  messages: [
    { role: "system", content: "输出 JSON 格式的工单分派建议" },
    { role: "user", content: "某路段交通信号灯损坏" },
  ],
  enableThinking: false,
});

console.log(result.data.department, result.endpoint);
```

---

## 目录结构

```text
packages/civic-system-two/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts                     # 统一导出（含 engine / adapters / parser / metrics / zod）
│   ├── types.ts                     # OpenAI 兼容入参出参、流式 Chunk 与 ClusterNodeSpec 类型
│   ├── engine.ts                    # 引擎主入口、健康路由、冷却自愈切回与 createJSON 工具
│   ├── parser.ts                    # <think> 提取分离与 JSON Markdown 清洗器
│   ├── metrics.ts                   # 节点最近耗时统计与秒级格式化
│   └── adapters/
│       ├── types.ts                 # 适配器接口标准 (ISystemTwoAdapter)
│       ├── abort-utils.ts           # AbortError 构造、识别与多信号联动
│       ├── sse-stream.ts            # OpenAI 兼容 SSE 流解析器
│       ├── local-metal-adapter.ts   # 单节点本地 Metal llama-server 适配器
│       ├── pooled-metal-adapter.ts  # 多节点算力池：3 秒探活复位，轮询后按在途数挑选
│       ├── cloud-openai-adapter.ts  # 远程云端 OpenAI 适配器（内置 scrubCloudPiiText 防护）
│       └── fallback-adapter.ts      # 离线安全兜底适配器
└── scripts/
    ├── setup.ts                     # 环境与模型物料自检脚本
    ├── serve.ts                     # 最优 Metal 参数本地启动脚本
    └── test-engine.ts               # 端到端自动化集成测试套件
```

---

## 运行自动化测试

```bash
pnpm --dir packages/civic-system-two test
```
