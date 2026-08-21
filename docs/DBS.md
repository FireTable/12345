# 数据库表结构与字段字典 (Database Schema & Dictionary)

> **项目名称**：民声智理 · 顺德 12345 AI 智能研判系统  
> **参赛团队**：赢了就回家吃鱼生  
> **ORM 框架**：Drizzle ORM (`drizzle-orm` + `postgres.js`)  
> **数据库引擎**：PostgreSQL 16 (支持 JSONB / 时区时间戳 / 高并发索引)

---

## 目录
1. [数据表关系拓扑 (ER Diagram)](#一数据表关系拓扑-er-diagram)
2. [7 大核心数据表详细字典](#二7-大核心数据表详细字典)
   - [1. 工单主表 (tickets)](#1-工单主表-tickets-ticketstable)
   - [2. 多频主题聚类表 (themes)](#2-多频主题聚类表-themes-themestable)
   - [3. 工单-主题关联表 (ticket_themes)](#3-工单-主题多对多关联表-ticket_themes-ticketthemestable)
   - [4. 人工复核队列 (review_queue)](#4-人工复核队列-review_queue-reviewqueuetable)
   - [5. 官方标准政务词汇表 (vocabularies)](#5-官方标准政务词汇表-vocabularies-vocabulariestable)
   - [6. 别名与实体对齐知识库 (aliases)](#6-别名与实体对齐知识库-aliases-aliasestable)
   - [7. 任务进度持久化表 (task_progress)](#7-任务进度持久化表-task_progress-taskprogresstable)
3. [数据库脚本与运维常用命令](#三数据库脚本与运维常用命令)

---

## 一、数据表关系拓扑 (ER Diagram)

```mermaid
erDiagram
    tickets ||--o{ ticket_themes : "1 对 多 (级联删除)"
    themes ||--o{ ticket_themes : "1 对 多 (级联删除)"
    tickets ||--o{ review_queue : "1 对 多 (低置信争议工单)"
    
    tickets {
        varchar(64) id PK "系统内部唯一工单 ID"
        varchar(64) ticket_no UK "工单业务唯一编号"
        text title "原始工单标题"
        text summarize_title "🤖 AI提炼一句话核心诉求"
        text content "诉求原始全量文本"
        text masked_content "🤖 脱敏展示正文"
        varchar(64) citizen_name "🤖 诉求人姓名(AI抽取+脱敏)"
        varchar(64) citizen_phone "🤖 诉求人电话(AI抽取+脱敏)"
        varchar(64) district "所属行政区(顺德区)"
        varchar(64) subdistrict "🤖 所属法定镇街(10大镇街)"
        varchar(64) source_category "🤖 7大标准民生分类"
        varchar(64) ingest_district "导入原始行政区"
        varchar(64) ingest_subdistrict "导入原始镇街"
        varchar(64) ingest_category "导入原始分类"
        varchar(16) urgency "紧急程度(NORMAL/URGENT)"
        varchar(255) address "🤖 诉求具体事发地址(AI抽取)"
        integer confidence "🤖 抽取置信度(0-100)"
        varchar(64) primary_theme_id "🤖 所属首要主题ID(聚类关联)"
        varchar(64) channel "诉求渠道来源"
        varchar(32) status "工单流转状态"
        timestamp create_time "诉求登记时间"
        timestamp closed_at "办结归档时间"
        varchar(32) closure_status "办结状态"
        boolean is_fake_closure "🚨🤖 假闭环告警标记(算法研判)"
        timestamp created_at "入库时间"
    }

    themes {
        varchar(64) id PK "多频主题唯一 ID"
        varchar(255) title "🤖 多频共性问题标题"
        varchar(255) canonical_subject "🤖 标准责任主体/车牌/字号"
        varchar(255) canonical_location "🤖 标准发生具体空间点位"
        varchar(128) event_type "🤖 核心事件类型提炼"
        varchar(64) category "🤖 7大标准民生分类"
        varchar(32) risk_level "🤖 风险定级(HIGH/MEDIUM/LOW)"
        text risk_reason "🤖 风险成因与激化归因分析"
        integer ticket_count "🤖 聚类关联工单总件数"
        integer time_span_hours "🤖 聚合时序跨度(小时)"
        text ai_summary "🤖 态势全貌分析与规律总结"
        text recommended_action "🤖 公文级协同处置建议"
        varchar(32) pattern_type "🤖 形态(INDIVIDUAL_REPEAT/GROUP_GATHERING)"
        varchar(16) civic_mode "🤖 治理模式(AUTO/ARBITRATED)"
        integer ai_confidence "🤖 综合研判置信度"
        timestamp first_at "首单发生时间"
        timestamp last_at "末单发生时间"
        varchar(16) handling_status "督办状态(未处理/处理中/已办结)"
        integer handling_progress "督办处置进度(0-100)"
        varchar(64) handling_owner "责任科室/承办人"
        timestamp handling_eta "承诺办结时限"
        text features_json "🤖 主题特征向量/属性 JSON"
        text radar_json "🤖 多维雷达图评分 JSON"
        integer trend_pct "🤖 环比增长率(%)"
        timestamp created_at "主题生成时间"
    }

    ticket_themes {
        varchar(64) ticket_id PK,FK "工单 ID"
        varchar(64) theme_id PK,FK "主题 ID"
        timestamp created_at "关联建立时间"
    }

    review_queue {
        varchar(64) id PK "复核记录 ID"
        varchar(64) ticket_id FK "争议工单 ID"
        varchar(128) reason "🤖 触发复核原因(LOW_CONFIDENCE/GENERIC_SUBJECT)"
        integer confidence "🤖 初审模型置信度"
        varchar(32) status "复核状态(PENDING/REVIEWED/DISMISSED)"
        varchar(64) operator "人工复核员"
        text note "复核批注与裁定意见"
        timestamp created_at "推入队列时间"
        timestamp reviewed_at "办结复核时间"
    }

    vocabularies {
        varchar(64) id PK "词汇 ID"
        varchar(32) type "词汇类型(TOWNSHIP/COMMUNITY/CATEGORY/DEPT)"
        varchar(128) name "标准规范名称"
        varchar(255) full_name "官方全称"
        varchar(128) parent_name "上级归属辖区"
        text meta_json "扩展元数据 JSON"
        text description "词汇释义说明"
        boolean is_standard "是否法定白名单强约束"
        timestamp created_at "沉淀入库时间"
    }

    aliases {
        varchar(64) id PK "别名记录 ID"
        varchar(128) alias UK "口语/简称/地标俗称"
        varchar(128) canonical "归一化法定名称"
        varchar(32) type "实体类型(TOWNSHIP/LOCATION/SUBJECT)"
        varchar(32) source "🤖 来源(PRESET/AI_MINED/MANUAL)"
        integer usage_count "🤖 命中与替换频次"
        timestamp created_at "建立时间"
    }

    task_progress {
        varchar(128) task_id PK "研判任务 ID"
        varchar(32) status "状态(PENDING/RUNNING/COMPLETED/FAILED)"
        varchar(32) stage "🤖 执行阶段(PARSING/EXTRACTING/CLUSTERING/COMPLETED)"
        text stage_text "阶段中文描述"
        integer percent "百分比进度(0-100)"
        integer total "总工单数"
        integer processed "已处理单数"
        integer extracted_count "🤖 已抽取要素数"
        integer theme_count "🤖 已生成主题数"
        integer review_count "🤖 已入复核数"
        integer failed_count "失败处理数"
        text error "错误日志信息"
        timestamp created_at "启动时间"
        timestamp updated_at "最近心跳时间"
    }
```

---

## 二、7 大核心数据表详细字典

### 1. 工单主表：`tickets` (`ticketsTable`)
> 存储工单全生命周期基础记录，承载原始诉求、🤖 AI 结构化抽取字段、脱敏正文及 🚨 假闭环研判标签。

| 字段名 | 数据库类型 | 约束 / 索引 | 描述 | 数据来源 / 算法说明 |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `VARCHAR(64)` | `PRIMARY KEY` | 工单唯一系统主键 ID | 系统按 `tk-{timestamp}-{index}` 自动分配 |
| `ticket_no` | `VARCHAR(64)` | `NOT NULL, UNIQUE, INDEX` | 12345 业务工单编号 | 原始表格工单编号（如 `250101000020109-01`） |
| `title` | `TEXT` | `NULLABLE` | 原始工单标题 | 保留原始表格标题，严禁覆盖 |
| `summarize_title` | `TEXT` | `NULLABLE` | 🤖 AI 提炼一句话核心标题 | 由 LLM 自动生成的标准摘要标题 |
| `content` | `TEXT` | `NOT NULL` | 工单原始诉求全文 | 核心数据源（含事发时间、地点、涉事方、诉求细节） |
| `masked_content` | `TEXT` | `NULLABLE` | 🤖 隐私脱敏展示文本 | 经 `anonymizer.ts` 对人名、手机、门牌等关键 PII 掩码后的安全文本 |
| `citizen_name` | `VARCHAR(64)` | `NULLABLE` | 🤖 诉求人姓名 | 🤖 结构化抽取并做脱敏掩码（如 `张*`） |
| `citizen_phone` | `VARCHAR(64)` | `NULLABLE` | 🤖 诉求人联系电话 | 🤖 结构化抽取并做脱敏掩码（如 `138****1234`） |
| `district` | `VARCHAR(64)` | `NULLABLE` | 所属行政区划 | 默认为佛山市“顺德区” |
| `subdistrict` | `VARCHAR(64)` | `INDEX, NULLABLE` | 🤖 法定归属镇街 | 经法定白名单与别名引擎归一后的 10 大法定辖区 |
| `source_category` | `VARCHAR(64)` | `INDEX, NULLABLE` | 🤖 7大标准民生分类 | 城市管理/市场监管/社会治理/交通出行/生态环境/劳动社保/公共安全 |
| `ingest_district` | `VARCHAR(64)` | `NULLABLE` | 导入原始行政区 | 导入文件原始区划字段（未经 AI 处理） |
| `ingest_subdistrict` | `VARCHAR(64)` | `NULLABLE` | 导入原始镇街 | 导入文件原始镇街字段（未经 AI 处理） |
| `ingest_category` | `VARCHAR(64)` | `NULLABLE` | 导入原始诉求分类 | 导入文件原始分类字段（未经 AI 处理） |
| `urgency` | `VARCHAR(16)` | `INDEX, DEFAULT 'NORMAL'` | 紧急度评级 | `NORMAL` 普通 / `URGENT` 加急诉求 |
| `address` | `VARCHAR(255)` | `NULLABLE` | 🤖 事发具体物理门牌/路段 | 🤖 从正文中由 LLM 抽取的微观空间点位 |
| `confidence` | `INTEGER` | `NULLABLE` | 🤖 抽取置信度得分 (0~100) | 🤖 结构化抽取质量打分，`< 60` 触发二级 AI 仲裁 |
| `primary_theme_id` | `VARCHAR(64)` | `INDEX, NULLABLE` | 🤖 首要归属主题 ID | 🤖 聚类后关联的核心多频群组 ID |
| `channel` | `VARCHAR(64)` | `DEFAULT '市民服务热线'` | 诉求来源渠道 | 市民热线 / 微信小程序 / 市长信箱 |
| `status` | `VARCHAR(32)` | `INDEX, DEFAULT 'PENDING'` | 流转状态 | `PENDING` 待研判 / `PROCESSING` 处置中 / `RESOLVED` 已结案 |
| `create_time` | `TIMESTAMP` | `INDEX, NULLABLE` | 诉求登记发生时间 | 结构化提取的标准发生时间戳 |
| `closed_at` | `TIMESTAMP` | `INDEX, NULLABLE` | 办结归档时间 | 业务系统反馈的结案时间戳 |
| `closure_status` | `VARCHAR(32)` | `NULLABLE` | 办结结论状态 | `已办结` / `处理中` / `退单` |
| `is_fake_closure` | `BOOLEAN` | `DEFAULT FALSE` | 🚨🤖 假闭环告警标旗 | 🤖 办结后 72 小时内在同一空间同因再次投诉时置为 `true` |
| `created_at` | `TIMESTAMP` | `NOT NULL, DEFAULT NOW` | 入库时间 | 记录创建时间 |

---

### 2. 多频主题聚类表：`themes` (`themesTable`)
> 存储经双轨聚类、二级仲裁与公文级全貌研判后的多频治理主题。

| 字段名 | 数据库类型 | 约束 / 索引 | 描述 | 数据来源 / 算法说明 |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `VARCHAR(64)` | `PRIMARY KEY` | 多频主题唯一 ID | 系统按 `thm-{timestamp}-{index}` 自动分配 |
| `title` | `VARCHAR(255)` | `NOT NULL` | 🤖 多频共性问题标题 | 🤖 由 Summary 节点概括的共性治理主题 |
| `canonical_subject` | `VARCHAR(255)` | `NOT NULL, INDEX` | 🤖 标准责任主体 | 🤖 100% 字符对齐的主体（如特定车牌号、商铺字号） |
| `canonical_location` | `VARCHAR(255)` | `NOT NULL` | 🤖 标准发生空间位置 | 🤖 微观空间拓扑聚合的标准点位（如具体小区/门牌） |
| `event_type` | `VARCHAR(128)` | `NOT NULL` | 🤖 核心事件类型 | 🤖 抽象标准业务事件（如“夜间餐饮油烟排放与排风机噪音”） |
| `category` | `VARCHAR(64)` | `DEFAULT '城市管理'` | 🤖 7大标准民生分类 | 🤖 城市管理/市场监管/社会治理/交通出行/生态环境/劳动社保/公共安全 |
| `risk_level` | `VARCHAR(32)` | `NOT NULL, INDEX, DEFAULT 'LOW'` | 🤖 风险研判等级 | 🤖 `HIGH` 红色高危 / `MEDIUM` 黄色中危 / `LOW` 蓝色常规 |
| `risk_reason` | `TEXT` | `NULLABLE` | 🤖 风险归因与激化分析 | 🤖 包含诉求集中度、矛盾激化因素、群体性隐患剖析 |
| `ticket_count` | `INTEGER` | `NOT NULL, INDEX, DEFAULT 0`| 🤖 聚合工单总件数 | 🤖 该多频群组下包含的工单数 |
| `time_span_hours` | `INTEGER` | `NOT NULL, DEFAULT 1` | 🤖 爆发时间跨度 (小时) | 🤖 最大与最小发生时间的间隔 |
| `ai_summary` | `TEXT` | `NULLABLE` | 🤖 态势全貌分析摘要 | 🤖 高层研判简报，总结集中爆发的时段规律与核心诉求 |
| `recommended_action`| `TEXT` | `NULLABLE` | 🤖 公文级协同处置建议 | 🤖 精准指定牵头部门、协办部门、时限要求及法定办理路径 |
| `pattern_type` | `VARCHAR(32)` | `INDEX, NULLABLE` | 🤖 聚类形态分类 | 🤖 `INDIVIDUAL_REPEAT` (主体重复) / `GROUP_GATHERING` (群体聚集) |
| `civic_mode` | `VARCHAR(16)` | `NULLABLE` | 🤖 治理模式 | 🤖 `AUTO` 算法自主 / `ARBITRATED` 二级仲裁纠偏 |
| `ai_confidence` | `INTEGER` | `NULLABLE` | 🤖 研判置信度评分 | 🤖 综合质检置信度得分 (0~100) |
| `first_at` / `last_at`| `TIMESTAMP` | `NULLABLE` | 首末单发生时间 | 群组内最早及最新工单登记时间 |
| `handling_status` | `VARCHAR(16)` | `DEFAULT '未处理'` | 全周期督办状态 | `未处理` / `处置中` / `已办结` |
| `handling_progress`| `INTEGER` | `DEFAULT 0` | 督办进度百分比 | 0 ~ 100 整数进度 |
| `handling_owner` | `VARCHAR(64)` | `NULLABLE` | 牵头承办责任科室 | 如“大良街道综合行政执法办” |
| `handling_eta` | `TIMESTAMP` | `NULLABLE` | 承诺办结时限 | 督办截止时限要求 |
| `features_json` | `TEXT` | `NULLABLE` | 🤖 特征向量/属性 JSON | 🤖 聚类多维特征序列化字段 |
| `radar_json` | `TEXT` | `NULLABLE` | 🤖 多维雷达图评分 JSON | 🤖 诉求复杂度、影响面、解决难度等多维雷达打分 |
| `trend_pct` | `INTEGER` | `NULLABLE` | 🤖 环比爆发增长率 (%) | 🤖 相比历史基线的激化增长百分比 |
| `created_at` | `TIMESTAMP` | `NOT NULL, DEFAULT NOW` | 主题生成时间 | 记录创建时间戳 |

---

### 3. 工单-主题多对多关联表：`ticket_themes` (`ticketThemesTable`)

| 字段名 | 数据库类型 | 约束 / 索引 | 描述 |
| :--- | :--- | :--- | :--- |
| `ticket_id` | `VARCHAR(64)` | `PRIMARY KEY (复合), FK -> tickets.id (CASCADE), INDEX` | 关联的底层工单 ID |
| `theme_id` | `VARCHAR(64)` | `PRIMARY KEY (复合), FK -> themes.id (CASCADE), INDEX` | 关联的多频主题 ID |
| `created_at` | `TIMESTAMP` | `NOT NULL, DEFAULT NOW` | 关联建立时间戳 |

---

### 4. 人工复核队列：`review_queue` (`reviewQueueTable`)
> 承接首轮置信度低、主体歧义或存在争议的工单，形成“人机协同”闭环。

| 字段名 | 数据库类型 | 约束 / 索引 | 描述 |
| :--- | :--- | :--- | :--- |
| `id` | `VARCHAR(64)` | `PRIMARY KEY` | 复核记录主键 ID |
| `ticket_id` | `VARCHAR(64)` | `NOT NULL, FK -> tickets.id (CASCADE), INDEX` | 关联的争议工单 ID |
| `reason` | `VARCHAR(128)`| `NOT NULL, DEFAULT 'LOW_CONFIDENCE'` | 🤖 触发复核原因（如低置信度、虚词主体、跨区冲突） |
| `confidence`| `INTEGER` | `NULLABLE` | 🤖 首轮模型给出的置信度 |
| `status` | `VARCHAR(32)` | `NOT NULL, INDEX, DEFAULT 'PENDING'` | 复核状态 (`PENDING` 待审 / `REVIEWED` 已修正 / `DISMISSED` 忽略) |
| `operator` | `VARCHAR(64)` | `NULLABLE` | 承办复核员工号/姓名 |
| `note` | `TEXT` | `NULLABLE` | 人工批注与仲裁意见 |
| `created_at`| `TIMESTAMP` | `NOT NULL, DEFAULT NOW` | 推入队列时间 |
| `reviewed_at`| `TIMESTAMP`| `NULLABLE` | 人工复核完成时间 |

---

### 5. 官方标准政务词汇表：`vocabularies` (`vocabulariesTable`)
> 严格固化顺德区 10 大法定镇街、98+ 村居社区与 7 大民生分类白名单，作为 Prompt 强约束输入。

| 字段名 | 数据库类型 | 约束 / 索引 | 描述 |
| :--- | :--- | :--- | :--- |
| `id` | `VARCHAR(64)` | `PRIMARY KEY` | 词汇唯一 ID |
| `type` | `VARCHAR(32)` | `NOT NULL, INDEX` | 类别：`TOWNSHIP` 镇街 / `COMMUNITY` 村居 / `CATEGORY` 分类 / `DEPARTMENT` 部门 |
| `name` | `VARCHAR(128)`| `NOT NULL, INDEX` | 标准名称（如 `容桂街道`、`大良街道`、`城市管理`） |
| `full_name`| `VARCHAR(255)`| `NULLABLE` | 官方全称（如 `佛山市顺德区容桂街道办事处`） |
| `parent_name`|`VARCHAR(128)`| `NULLABLE` | 上级归属辖区（如所属镇街名） |
| `meta_json` | `TEXT` | `NULLABLE` | 扩展元数据 JSON（如辖区边界、人口、负责人等） |
| `description`| `TEXT` | `NULLABLE` | 词汇释义与权责说明 |
| `is_standard`|`BOOLEAN` | `NOT NULL, DEFAULT TRUE` | 是否为法定白名单强约束 |
| `created_at`| `TIMESTAMP` | `NOT NULL, DEFAULT NOW` | 词汇录入时间 |

---

### 6. 别名与实体对齐知识库：`aliases` (`aliasesTable`)
> 口语俗称与法定称谓映射表，支持运行期大模型自动挖掘与异步自学习沉淀。

| 字段名 | 数据库类型 | 约束 / 索引 | 描述 |
| :--- | :--- | :--- | :--- |
| `id` | `VARCHAR(64)` | `PRIMARY KEY` | 别名映射唯一 ID |
| `alias` | `VARCHAR(128)`| `NOT NULL, UNIQUE, INDEX` | 市民口语俗称/简称（如 `容奇`、`桂洲`、`德胜新区`） |
| `canonical`| `VARCHAR(128)`| `NOT NULL, INDEX` | 对应的法定权威标准名（如 `容桂街道`、`大良街道`） |
| `type` | `VARCHAR(32)` | `NOT NULL, INDEX, DEFAULT 'ENTITY'` | 实体类型 (`TOWNSHIP` / `LOCATION` / `SUBJECT`) |
| `source` | `VARCHAR(32)` | `NOT NULL, DEFAULT 'PRESET'` | 🤖 沉淀来源 (`PRESET` 预置 / `AI_MINED` AI自学习 / `MANUAL` 手工维护) |
| `usage_count`|`INTEGER` | `NOT NULL, DEFAULT 0` | 🤖 匹配与替换命中累计计数 |
| `created_at`| `TIMESTAMP` | `NOT NULL, DEFAULT NOW` | 创建时间 |

---

### 7. 任务进度持久化表：`task_progress` (`taskProgressTable`)
> 记录 LangGraph 图工作流异步执行状态与前端实时进度推送。

| 字段名 | 数据库类型 | 约束 / 索引 | 描述 |
| :--- | :--- | :--- | :--- |
| `task_id` | `VARCHAR(128)`| `PRIMARY KEY` | 异步研判任务 ID (`task-cluster-{timestamp}`) |
| `status` | `VARCHAR(32)` | `NOT NULL, INDEX, DEFAULT 'PENDING'` | 任务状态 (`PENDING` / `RUNNING` / `COMPLETED` / `FAILED`) |
| `stage` | `VARCHAR(32)` | `NOT NULL, DEFAULT 'EXTRACTING'` | 🤖 执行阶段 (`PARSING` / `EXTRACTING` / `CLUSTERING` / `SYNTHESIZING` / `COMPLETED`) |
| `stage_text`| `TEXT` | `NOT NULL, DEFAULT '准备就绪'` | 前端实时展示的中文阶段提示 |
| `percent` | `INTEGER` | `NOT NULL, DEFAULT 0` | 当前百分比进度 (0~100) |
| `total` | `INTEGER` | `NOT NULL, DEFAULT 0` | 待处理工单总数 |
| `processed`| `INTEGER` | `NOT NULL, DEFAULT 0` | 已完成处理单数 |
| `extracted_count`| `INTEGER` | `NOT NULL, DEFAULT 0` | 🤖 已完成要素抽取单数 |
| `theme_count`|`INTEGER` | `NOT NULL, DEFAULT 0` | 🤖 当前已挖掘出主题数 |
| `review_count`|`INTEGER`| `NOT NULL, DEFAULT 0` | 🤖 推入复核队列的工单数 |
| `failed_count`|`INTEGER`| `NOT NULL, DEFAULT 0` | 处理失败单数 |
| `error` | `TEXT` | `NULLABLE` | 异常报错详细信息 |
| `created_at`| `TIMESTAMP` | `NOT NULL, DEFAULT NOW` | 任务创建启动时间 |
| `updated_at`| `TIMESTAMP` | `NOT NULL, INDEX, DEFAULT NOW`| 最近心跳更新时间 |

---

### 8. 用户与认证体系表 (Better Auth Security Schema)
> 生产级用户认证与会话状态持久化表体系。

#### (1) 用户信息表：`user` (`userTable`)
| 字段名 | 数据库类型 | 约束 | 描述 |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | `PRIMARY KEY` | 用户唯一标识 UUID |
| `name` | `TEXT` | `NOT NULL` | 用户姓名/昵称（如 `系统管理员`） |
| `email` | `TEXT` | `NOT NULL, UNIQUE` | 登录邮箱/主标识 |
| `email_verified`| `BOOLEAN` | `NOT NULL, DEFAULT false` | 邮箱是否已校验 |
| `image` | `TEXT` | `NULLABLE` | 用户头像 URL |
| `role` | `TEXT` | `NOT NULL, DEFAULT 'user'` | 权限角色 (`admin` / `user` / `operator`) |
| `username` | `TEXT` | `UNIQUE, NULLABLE` | 用户名标识 (如 `admin`) |
| `created_at` | `TIMESTAMP` | `NOT NULL, DEFAULT NOW` | 创建时间 |
| `updated_at` | `TIMESTAMP` | `NOT NULL, DEFAULT NOW` | 更新时间 |

#### (2) 会话表：`session` (`sessionTable`)
| 字段名 | 数据库类型 | 约束 | 描述 |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | `PRIMARY KEY` | 会话唯一 ID |
| `expires_at` | `TIMESTAMP` | `NOT NULL` | 会话过期时间戳 |
| `token` | `TEXT` | `NOT NULL, UNIQUE` | Session Token 密钥 |
| `ip_address` | `TEXT` | `NULLABLE` | 客户端登录 IP |
| `user_agent` | `TEXT` | `NULLABLE` | 客户端浏览器 User-Agent |
| `user_id` | `TEXT` | `NOT NULL, REFERENCES user(id)` | 关联用户 ID (级联删除) |
| `created_at` | `TIMESTAMP` | `NOT NULL, DEFAULT NOW` | 创建时间 |
| `updated_at` | `TIMESTAMP` | `NOT NULL, DEFAULT NOW` | 更新时间 |

#### (3) 账号凭据表：`account` (`accountTable`)
| 字段名 | 数据库类型 | 约束 | 描述 |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | `PRIMARY KEY` | 凭据唯一 ID |
| `account_id` | `TEXT` | `NOT NULL` | 凭据提供商内部账号 ID |
| `provider_id` | `TEXT` | `NOT NULL` | 认证提供商 (`credential` / `username` 等) |
| `user_id` | `TEXT` | `NOT NULL, REFERENCES user(id)` | 关联用户 ID (级联删除) |
| `password` | `TEXT` | `NULLABLE` | 加密哈希密码 (scrypt/bcrypt 密文) |
| `issuer` | `TEXT` | `NULLABLE` | 认证颁发者 |
| `created_at` | `TIMESTAMP` | `NOT NULL, DEFAULT NOW` | 创建时间 |
| `updated_at` | `TIMESTAMP` | `NOT NULL, DEFAULT NOW` | 更新时间 |

---

## 三、数据库脚本与运维常用命令

| 业务目标 | 对应 NPM 命令 | 底层脚本路径 | 说明 |
| :--- | :--- | :--- | :--- |
| **数据库迁移** | `pnpm db:migrate` | `scripts/db-migrate.ts` | 执行 `db/migrations/` 下的 SQL 迁移脚本 |
| **全量词库填充** | `pnpm db:vocab` | `scripts/seed-vocabulary.ts` | 导入顺德 10 大镇街、村居及预置别名知识库 |
| **管理员账号初始化** | `pnpm db:seed-admin` | `scripts/seed-admin.ts` | 初始化/重置默认系统管理员账号 (`admin` / `admin`) |
| **脱敏样例工单** | `pnpm db:seed` | `scripts/db-seed.ts` | 写入 200 条真实脱敏抽样工单用于冒烟演示 |
| **数据备份导出** | `pnpm db:export` | `scripts/db-export.ts` | 导出全库数据为 `db/dumps/ticket_radar_data.json` |
| **数据离线恢复** | `pnpm db:import` | `scripts/db-import.ts` | 从 json dump 快速全量恢复库数据 |
| **Drizzle Studio** | `pnpm db:studio` | `drizzle-kit studio` | 启动本地可视化数据库管理控制台 (Port 4983) |
| **清空业务表** | `pnpm db:clear` | `scripts/db-clear.ts` | 安全清空工单与主题数据（保留词汇白名单） |
