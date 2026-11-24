# @civic/anonymizer

> 12345 政务工单与全渠道客诉全要素可逆脱敏引擎与实体回填状态机 (Civic Data Air-gap & Reversible Deanonymizer)

## 一、 设计原则

1. **出站无感隔离**：上送至外部或云端大模型的 Prompt 与工具输出均自动替换为标准化占位符（如 `{{LICENSE_PLATE_1}}`、`{{PHONE_NUMBER_1}}`、`{{EMAIL_1}}`），杜绝公民/买家个人隐私外泄或被模型供应商采集训练；
2. **实体一致性去重 (Value Deduplication)**：同一车牌、同一手机号或同一市民在正文反复出现多次，全篇始终绑定唯一的 Token，不分裂大模型的实体共指（Co-reference）认知；
3. **公私精细分治（6 类敏感要素）**：
   - **严格脱敏 (`CivicPiiCategory`)**：
     - `ID_CARD`（权重 0.99）：中国二代身份证（含 ISO 7064:1983.MOD 11-2 国标校验和）
     - `LICENSE_PLATE`（权重 0.95）：中国机动车号牌（含新能源及挂/学/警/港/澳后缀）
     - `EMAIL`（权重 0.92）：电子邮箱（优先级高于电话，防止 `13800138000@163.com` 被电话规则半截误切）
     - `PHONE_NUMBER`（权重 0.90）：手机号与带区号固话（支持 `159-766-73363` / `+86 159 7667 3363` 等连字符与空格分隔，同时通过负向预查拦截时间戳、工单号与超长连字符数字）
     - `PRIVATE_ROOM`（权重 0.88）：私人室内门牌房号（如 `7座304`、`327房`、`102室`）
     - `PERSON_NAME`（权重 0.85）：自然人真实姓名与特定称谓（屏蔽群体泛词）
   - **坚决保留**：法定行政区划、街道镇街、公共道路名、公开商业广场/园区、公共停车场、商户门头与 SKU 编码（确保下游时空图谱聚类与分派治理不瘫痪）；
4. **确定性深度无损还原 (`deanonymize`)**：模型推理完成后，通过会话级映射表（`keymap`）在内存中采用递归深拷贝 + 单次正则回调替换，将占位符 100% 精确复原为真实业务实体；不修改原输入对象，免疫 JSON 引号/反斜杠破坏、`$&/$1` 替换注入、`Date`/`RegExp` 丢失、循环引用与 `__proto__` 原型污染。

---

## 二、 自动化双向核验与三层出网防火墙定位

- **可逆性双向核验**：每次脱敏均生成严格对应的 `keymap` 与 `spans`，支持针对原始字符串与任意深层嵌套 JSON 对象的反向无损比对，保证反向还原率 100.0%；
- **国标数学校验和过滤**：采用中国二代身份证 ISO 7064:1983.MOD 11-2 加权算法，仅脱敏合法身份证，不误伤 18 位长流水号或快递运单号；
- **群体泛词防御**：精准区分自然人真实称谓与政务群体角色词，杜绝把“全部业主”、“广大业主”、“业主委员会”误判为自然人姓名；
- **生产级实测验证**：基于 128,278 条顺德政数局真实历史工单大样本抽测，平均处理时延约 **13 微秒/件**，吞吐达 **7.5 万单/秒**，反向还原一致率 100.0%；
- **三层出网 PII 脱敏防火墙核心底座**：在主应用与 `LightCopilot` 中，本包作为第一层与第二层核心脱敏引擎（会话输入、只读工具返回、`sanitizeMessagesForModel`），并与 `@civic/system-two` 的 `CloudOpenAIAdapter`（末公里 `scrubCloudPiiText`）共同构成完整出网防护链。

---

## 三、 快速上手

```typescript
import { anonymize, deanonymize } from "@civic/anonymizer";

const rawTicket = `市民陈先生（电话 159-766-73363，邮箱 user@example.com）反映其车辆（鄂B 1JQ53）停放在伦教街道人民路食街停车场，收费争议要求核查。`;

// 1. 出站前脱敏（支持指定 categories / seedKeymap / bracketStyle）
const { text, keymap } = anonymize(rawTicket, {
  bracketStyle: "double-curly", // 默认 {{CATEGORY_N}}，可选 "unicode-bracket" -> ⟦CATEGORY_N⟧
});
console.log(text);
// 市民{{PERSON_NAME_1}}（电话 {{PHONE_NUMBER_1}}，邮箱 {{EMAIL_1}}）反映其车辆（{{LICENSE_PLATE_1}}）停放在伦教街道人民路食街停车场，收费争议要求核查。

// 2. 模拟大模型推理返回的结构化抽取 JSON
const aiExtracted = {
  subject: "{{LICENSE_PLATE_1}}",
  complainant: "{{PERSON_NAME_1}}",
  contactPhone: "{{PHONE_NUMBER_1}}",
  contactEmail: "{{EMAIL_1}}",
  location: "伦教街道人民路食街停车场",
  eventType: "停车场违规收费争议",
};

// 3. 入库前一键无损反向还原（深拷贝，不修改 aiExtracted）
const finalData = deanonymize(aiExtracted, keymap);
console.log(finalData);
```

---

## 四、 业务流水线与跨 Agent 透传（`seedKeymap`）

在要素抽取（`ExtractNode`）、受理建单（`/api/intake/*`）与 `LightCopilot` 多轮工具调用中，通过传入上一阶段的 `seedKeymap` 可保证跨节点、跨轮次的实体占位符永久一致：

```typescript
// 1. 首轮脱敏并持久化会话映射
const round1 = anonymize(ticket.content);

// 2. 后续轮次或工具输出继承 seedKeymap
const round2 = anonymize("请问针对上述车辆与联系方式的核实情况...", {
  seedKeymap: round1.keymap,
});

// 3. 模型返回后执行一键实体回填
const enrichedTicket = deanonymize(aiOutput, round2.keymap);
```

---

## 五、 运行单元测试

```bash
pnpm exec tsx packages/civic-anonymizer/test/test-runner.ts
```
