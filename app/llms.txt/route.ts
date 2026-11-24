import { getAppDomainMode } from "@/lib/app-domain";

export const dynamic = "force-dynamic";

function resolveSiteBaseUrl(isEcommerce: boolean): string {
  const raw = (process.env.BETTER_AUTH_URL || "").trim();
  if (raw) {
    return raw.replace(/\/+$/, "");
  }
  return isEcommerce ? "https://ecom.firetable.tech" : "https://12345.firetable.tech";
}

function buildGovLlmsTxt(baseUrl: string): string {
  return `# 民声智理 · 12345 政务热线认知中枢与 AI 智能研判治理系统 (CivicPulse 12345)

> 面向 12345 市民服务热线的全闭环 AI 智能受理、多频工单研判与主动治理平台。融合 Kahneman 快慢双系统协同架构（System-1 端侧 4-Head ONNX + System-2 通用大模型多节点池）、3D 数字人语音受理、国家天地图 CGCS2000 测绘级 GIS 底座、PostgreSQL 多城市 Schema 物理隔离、L1/L2/L3 分级智能治理与三层出网 PII 脱敏防火墙。

## 在线双域名实例 (Live Deployments)

同一生产镜像（\`ticket-radar:v0.1.5\`）通过 \`APP_DOMAIN\` 环境变量与 PostgreSQL 独立 Schema 驱动双容器独立运行：

- [政务 12345 主站](https://12345.firetable.tech): \`APP_DOMAIN=GOV_12345\`（容器 \`12345-app\`），默认内置广州市·天河区（约 10.6 万条 / 106,543 条工单、21 街道）与佛山市·顺德区（约 13.8 万条 / 138,704 条工单、10 镇街）
- [跨行业电商客诉示范站](https://ecom.firetable.tech): \`APP_DOMAIN=ECOMMERCE_CS\`（容器 \`12345-ecom-app\`），复用同一引擎内核，内置全渠道电商售后客诉中心（3,240 条客诉、40 个专题、8 渠道 × 7 分类）
- [开源代码仓库](https://github.com/FireTable/12345): Next.js 15 + React 19 + LangGraph JS + Drizzle ORM + PostgreSQL 16 (pgvector) + Better Auth

## 核心认知与安全架构 (Core Architecture)

- **System-1 快思考（\`@civic/system-one\`）**: 4-Head 交叉注意力双流 ONNX 模型（4.5 MB，\`onnxruntime-node\` 本地原生内嵌），单条前向推理 0.079ms、吞吐 12,664.9 TPS；12,828 条全盲工单评测中涉稳护栏 99.86%（0 漏报）、紧迫等级 99.84%、诉求意图 99.75%、法定领域协同池 99.35%；内置 11 类极端涉稳红线符号词网（含 16 字否定/预防语境防误杀窗口）。
- **System-2 慢思考（\`@civic/system-two\`）**: 遵循 OpenAI Chat Completions 协议，支持思维链（\`reasoning_content\`）与纯正文分离、流式输出（\`createStream\`）、多节点算力集群（本地 Apple Silicon Metal 27B / Google Colab GPU 热挂载 / 云端灾备自动降级与 30s 冷却自愈切回），完成主体、地点、事件与一句话标准摘要四要素结构化抽取及公文级处置预案生成。
- **三层出网 PII 脱敏防火墙（\`@civic/anonymizer\` + Copilot + Cloud Adapter）**:
  1. 会话级可逆脱敏引擎（\`@civic/anonymizer\`）：13μs/件、7.5 万单/秒，覆盖二代身份证（ISO 7064:1983.MOD 11-2 校验和）、车牌、手机/固话（含连字符/空格分隔）、电子邮箱、私密房号与自然人姓名 6 类 PII，同时保留公共地标与商户门头，内存 O(1) 确定性无损回填；
  2. AI 研判副驾驶（\`LightCopilot\`）在每轮历史消息、工具返回与入模前强制执行 \`sanitizeMessagesForModel\`；
  3. 云端灾备适配器（\`CloudOpenAIAdapter\`）末公里 \`scrubCloudPiiText\` 兜底清洗身份证、银行卡、电话与邮箱。
- **同案同地时空语义聚类（\`@civic/embed\`）**: BAAI/bge-m3 高维向量 + 微观空间基底提纯 + 同地/同分类强约束，跨街区误聚率降至 0.0%。
- **国家天地图 CGCS2000 GIS 底座**: 接入天地图测绘级瓦片与四级镇街高精矢量面，消除 GCJ-02 坐标漂移。
- **多城市物理隔离与 AI 拓荒**: PostgreSQL \`region_{id}\` 独立物理 Schema + SuperAgent AI Scout 30 秒生成新辖区边界、社区白名单与别名词库。

## 全生命周期业务闭环与页面路由 (Application Routes)

- [数据总览态势大盘](${baseUrl}/): 辖区天地图热力态势、全量工单 KPI、分类分布与顶部 React Flow AI 研判流水线抽屉
- [市民智能受理门户](${baseUrl}/submit): 3D 数字人「小蠢」（\`@firetable/project-xiaochun\`）+ 流式语音转写（\`@firetable/stream-asr\` / \`VoiceChatComposer\`）对话受理、自动脱敏结构化建单、底部实时进度追踪与市民端假闭环重开
- [工单中心](${baseUrl}/tickets): 4 态统一流转（\`待派单 → 已派单 → 处理中 → 已办结\`，含 \`REOPENED\` 置顶）、\`缺资料\` 自动识别 + 一键让 Agent 语音外呼补全回写、\`疑似假闭环\` 与 \`待人工复核\` 纠偏沉淀别名
- [智能治理中心](${baseUrl}/agent): 三级 AI 自治（L1 自动执行 / L2 人工审批 / L3 红线熔断）、48h 满意度语音回访与假闭环自动重开、治理专报生成与导出
- [多频工单看板](${baseUrl}/themes): 同案同地群诉聚类列表、实体拓扑图谱与公文级处置预案（牵头/协办单位与响应时限）
- [工单透势研判](${baseUrl}/multifreq): 紧急×重要四象限矩阵、假闭环时序风险雷达与轻量化汇总视图
- [指挥调度大屏](${baseUrl}/screen): 4K/8K 城市运行管理中心（IOC）全景实时驾驶舱
- [标准字典治理](${baseUrl}/dict): 法定镇街/社区白名单树与政务别名自学习知识库
- [实时 X-Ray 演练沙箱](${baseUrl}/sandbox): 端到端实时观测脱敏、System-1 定性、要素抽取与假闭环撞库预警
- [统一认证门户](${baseUrl}/login): Better Auth 双角色 RBAC 登录与市民 2 秒自助注册（普通市民仅访问 \`/submit\`，管理端隔离）
- **AI 研判副驾驶（\`LightCopilot\`）**: 全站侧边抽屉，支持 1 轮并行预取极速简报、规范表格渲染与 Markdown 导出、\`civic-action\` 可执行提案卡片（仅人工确认后落库）

## 生产级性能与工程实测（\`ticket-radar:v0.1.5\` / Commit \`9b93585\`）

- **数据库索引与触发器（\`db/migrations/0012_perf_indexes.sql\`）**:
  - 持久化 \`tickets.is_missing_info\` 列 + \`BEFORE INSERT/UPDATE\` 触发器 + 部分索引 \`idx_tickets_missing_info_ct\`，消除全表正则扫描（天河 4.8× / 顺德 15.6×，0 磁盘读）；
  - \`tab=pending\` 三段索引归并分页（\`idx_tickets_reopened_updated_at\` + \`idx_tickets_fake_closure_pending\` + \`idx_tickets_status_create_time_id_desc\`），天河 106.5k 行 64.55ms → 0.25ms（**258×**）、顺德 138.7k 行 73.46ms → 0.25ms（**294×**），缓冲读取降 99.9%；
  - 覆盖索引 \`idx_tickets_stats_cover\` 与 \`idx_tickets_id_subd_status\`，VPS 热点查询实现 Index-Only Scan（**0 磁盘读**）。
- **缓存、鉴权与载荷瘦身**:
  - \`lib/civic-cache.ts\`：\`globalThis\` 共享 LRU（500 条）+ 60s/10min SWR 后台单飞刷新；
  - Better Auth \`session.cookieCache\`：5 分钟 HMAC 签名 Cookie 缓存，鉴权提速 **5.8×**；
  - \`/api/clusters\` 服务端分页与 \`?view=summary\`：载荷由 4.14~6.86 MB 压降至未压缩 5.4~7.6 KB / zstd 压缩后 1.3~1.9 KB（降幅 **99.8%+**）；
  - PostgreSQL 16 内存调优（\`shared_buffers=1GB\` / \`effective_cache_size=4GB\` / \`jit=off\`）+ Caddy \`@streaming\` 无缓冲透传与常规接口 \`zstd/gzip\` 分流。

## 开放生态协议与公开端点 (MCP & Public APIs)

- [公开 KPI 概览](${baseUrl}/api/public/overview): 无需登录返回非敏感汇总统计
- [MCP OAuth 受保护资源发现](${baseUrl}/.well-known/oauth-protected-resource): Model Context Protocol \`2025-03-26\` 发现端点
- [MCP OAuth 授权服务元数据](${baseUrl}/.well-known/oauth-authorization-server): OAuth 2.0 授权发现元数据
- **MCP Streamable HTTP 端点（\`POST ${baseUrl}/api/mcp\`）**: 暴露 \`list_regions\`、\`push_ticket\`、\`region_overview\` 三大标准工具

## 核心文档索引 (Documentation)

- [项目总览 README](https://github.com/FireTable/12345/blob/main/README.md): 产品亮点、全链路闭环、性能实测与本地运行指南
- [生产部署与运维手册](https://github.com/FireTable/12345/blob/main/docs/DEPLOY.md): 本地开发、双域名 Docker Compose 与离线私有化部署
- [AI 研判认知工作流规范](https://github.com/FireTable/12345/blob/main/docs/WORKFLOW.md): System-1/2 状态机、同案同地聚类与主动治理编排
- [空间地理与天地图 GIS 规范](https://github.com/FireTable/12345/blob/main/docs/SPATIAL.md): CGCS2000 无偏移底图与四级镇街矢量面标准
- [MCP 接入指南](https://github.com/FireTable/12345/blob/main/docs/MCP.md): 外部智能体 OAuth 授权与工具调用说明
- [多租户数据库设计规范](https://github.com/FireTable/12345/blob/main/docs/DBS.md): PostgreSQL Schema 物理隔离、索引与字典表定义
- [Colab / 远程 GPU 算力套件](https://github.com/FireTable/12345/blob/main/scripts/colab/README.md): 一键热挂载 System-2 与 BGE-M3 远程算力节点
`;
}

function buildEcommerceLlmsTxt(baseUrl: string): string {
  return `# 民声智理 · 全渠道电商售后客诉认知中枢与 AI 智能研判系统 (CivicPulse E-Commerce CS)

> 民声智理认知治理内核在全渠道电商售后客诉场景的独立示范实例。与 12345 政务热线主站复用同一生产镜像（\`ticket-radar:v0.1.5\`），通过 \`APP_DOMAIN=ECOMMERCE_CS\` 与 PostgreSQL 独立 Schema 实现物理级业务隔离，预置 3,240 条全渠道模拟客诉、40 个专题，覆盖 8 大销售渠道与 7 类售后问题。

## 在线双域名实例 (Live Deployments)

- [电商售后客诉示范站（本站）](https://ecom.firetable.tech): \`APP_DOMAIN=ECOMMERCE_CS\`（容器 \`12345-ecom-app\`），内置 \`ecom_demo\` 全渠道电商售后客诉中心（3,240 条客诉 / 40 个专题）
- [政务 12345 热线主站](https://12345.firetable.tech): \`APP_DOMAIN=GOV_12345\`（容器 \`12345-app\`），内置广州市·天河区（~10.6 万条）与佛山市·顺德区（~13.8 万条）真实规模政务热线数据
- [开源代码仓库](https://github.com/FireTable/12345): Next.js 15 + React 19 + LangGraph JS + Drizzle ORM + PostgreSQL 16 (pgvector) + Better Auth

## 核心能力与电商场景闭环 (E-Commerce Capabilities)

- **买家智能受理门户（[/submit](${baseUrl}/submit)）**: 3D 数字人「小蠢」+ 流式语音转写（\`VoiceChatComposer\`）对话受理售后问题，自动结构化抽取渠道、SKU、问题分类并脱敏联系方式；底部提供实时工单进度追踪及买家端「未解决，申请重开」假闭环申诉。
- **客诉工单中心（[/tickets](${baseUrl}/tickets)）**: 4 态统一流转（\`待派单 → 已派单 → 处理中 → 已办结\`），内置 \`缺资料\`（缺失渠道/SKU/责任主体自动识别，电商端同步校验 \`char_length(address) <= 6\`）与一键 Agent 语音外呼补全、\`疑似假闭环\`、\`待人工复核\` 标签页。
- **AI 主动治理与红线熔断（[/agent](${baseUrl}/agent)）**: L1 自动执行覆盖多频专题超期催办（\`SLA_OVERDUE\`）与电商低风险缺资料语音补全（\`MISSING_INFO\`）；L2 人工审批覆盖 48h 挽回回访与假闭环重开（\`REOPEN_CALLBACK\`）以及 Copilot 批量派单/升级/办结提案，须人工确认生效；L3 红线熔断（\`REDLINE_BLOCK\`）在命中食品安全、12315 监管或社媒舆情红线时强制拦截 AI 自动外联并转交法务/主管专班；支持治理专报自动生成与导出。
- **多频客诉与 SKU 聚类（[/themes](${baseUrl}/themes) & [/multifreq](${baseUrl}/multifreq)）**: 跨渠道归并同款 SKU / 同仓网批量客诉（如冷链失温、破损漏液、客服机械安抚复发），输出四象限风险矩阵与处置方案。
- **AI 研判副驾驶（\`LightCopilot\`）**: 1 轮并行预取极速客诉简报、规范表格与 Markdown 导出、\`civic-action\` 可执行派单/督办提案卡片，以及三层出网 PII 脱敏防火墙（\`@civic/anonymizer\` 可逆脱敏 + Copilot 审查 + 云端末公里清洗）。
- **指挥大屏、字典与沙箱**: [指挥大屏](${baseUrl}/screen)、[标准字典](${baseUrl}/dict)、[X-Ray 沙箱](${baseUrl}/sandbox)、[统一认证门户](${baseUrl}/login)。

## 底层技术与实测性能（\`ticket-radar:v0.1.5\` / Commit \`9b93585\`）

- **快慢双系统**: System-1 端侧 4-Head ONNX（0.079ms / 12,664 TPS）+ System-2 通用大模型多节点池（支持 Apple Silicon Metal / Colab GPU / 云端自动容灾）。
- **数据库与接口优化**: \`0012_perf_indexes.sql\` 触发器维护 \`is_missing_info\` 列与覆盖索引（热点查询 0 磁盘读、\`tab=pending\` 三段归并 258×~294× 提速）、\`lib/civic-cache.ts\` SWR 缓存、Better Auth \`cookieCache\`（5.8×）、\`/api/clusters\` 服务端分页与 \`?view=summary\`（载荷降 99.8%+）。
- **开放生态**: 原生支持 Model Context Protocol (\`2025-03-26\`)，发现端点 [${baseUrl}/.well-known/oauth-protected-resource](${baseUrl}/.well-known/oauth-protected-resource)，公开统计端点 [${baseUrl}/api/public/overview](${baseUrl}/api/public/overview)。

## 核心文档索引 (Documentation)

- [项目总览 README](https://github.com/FireTable/12345/blob/main/README.md)
- [生产部署与运维手册](https://github.com/FireTable/12345/blob/main/docs/DEPLOY.md)
- [AI 研判认知工作流规范](https://github.com/FireTable/12345/blob/main/docs/WORKFLOW.md)
- [MCP 接入指南](https://github.com/FireTable/12345/blob/main/docs/MCP.md)
- [多租户数据库设计规范](https://github.com/FireTable/12345/blob/main/docs/DBS.md)
`;
}

export async function GET() {
  const isEcommerce = getAppDomainMode() === "ECOMMERCE_CS";
  const baseUrl = resolveSiteBaseUrl(isEcommerce);
  const body = isEcommerce ? buildEcommerceLlmsTxt(baseUrl) : buildGovLlmsTxt(baseUrl);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}
