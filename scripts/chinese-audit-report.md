# 项目非注释代码中文审查全景报告

> 本报告由 `scripts/scan-chinese.ts` 自动生成，已过滤掉全部单行注释 (`//`)、块级注释 (`/* ... */`) 与 JSX 注释。

## 📊 统计汇总
- **扫描目录**: `backend/`, `lib/`, `app/api/`
- **涉及代码文件数**: 37 个
- **含非注释中文代码行**: 1612 行

### 分类分布

| 类别 | 描述 | 出现行数 | 建议治理方案 |
| :--- | :--- | :--- | :--- |
| **中文拼装模板** | 字符串插值拼接（如 `微观地点【${loc}】...集中出现`） | 72 行 | 彻底交由 LLM 或动态模板引擎生成，消除写死句式 |
| **规则与判断逻辑** | 包含特定中文词的 `includes` / 正则分支 | 28 行 | 移除特定词死判断，改为纯数据驱动或模型抽取 |
| **默认兜底中文** | 缺省回退词（如 `|| "城市管理"`, `|| "热线市民"`） | 67 行 | 动态回退到当前站点的 `vocab.categories[0]` |
| **AI 提示词** | 引导大模型的 Prompt 模板与 Few-Shot | 1 行 | 保留或放入提示词配置中心，地名注入动态变量 |
| **预置字典数据** | 默认顺德/广州预置区划字典 | 14 行 | 移至数据库与独立 JSON 种子文件维护 |
| **其他常量与消息** | API 返回文案与状态码说明 | 1430 行 | 统一收拢到 `lib/api-codes.ts` |

## 一、重点排查：中文拼装与硬编码生成逻辑 (72 处)

> 用户重点关注的 `微观点位群发`、`建议属地综合行政执法队...` 等字符串拼装集中于此：

#### `backend/node/arbitrator-node.ts`
```typescript
L100: summarizeTitle: `关于${validTownship}${normalizedSubject}${arbitrated.correctedEventType || firstPass.eventType}诉求`,
```

#### `backend/node/cluster-node.ts`
```typescript
L66: stageText: `正在构建多频知识图谱连通子图 (输入 ${enrichedTickets.length} 条已富化工单)...`,
L108: const canonicalLocation = distinctLocations.length === 1 ? distinctLocations[0] : `${distinctLocations[0]} 等多处`;
L145: ? `办结${RULES.fakeClosure.windowDays}天内再次诉求（${reopenCount}次）`
L146: : `同一主体短时高频反映（${tickets.length}件）`,
L201: const canonicalSubject = distinctSubjects.length > 0 ? distinctSubjects.join("、") : `${microLocation}周边涉事对象`;
L204: const title = `${microLocation} — ${eventType}群发共性问题`;
L239: ? `办结${RULES.fakeClosure.windowDays}天内同一地点再次诉求（${reopenCount}次）`
L240: : `同一微观点位短时集中反映（${tickets.length}件）`,
```

#### `backend/node/cluster-validator.ts`
```typescript
L31: return { passed: false, rejectedReason: `涉事主体为通用虚词 [${subject}]，严禁单独成群` };
L34: return { passed: false, rejectedReason: `涉事主体包含非法泛化后缀 [${subject}]` };
L45: return { passed: false, rejectedReason: `跨车牌号串扰混淆：目标车牌 [${targetPlate}] 与成员工单主体 [${tPlateMatch[1]}] 不一致` };
L52: return { passed: false, rejectedReason: `聚类工单数 [${clusterTickets.length}] 未达到多频最低门槛 [${RULES.minClusterSize}]` };
L67: return { passed: false, rejectedReason: `聚类工单跨越 ${distinctTownships.size} 个不同镇街，涉嫌跨区误绑` };
L74: return { passed: false, rejectedReason: `聚类工单平均抽取置信度过低 (${avgConfidence.toFixed(1)}分)` };
L97: console.warn(`[ClusterValidator] 剔除不合规多频聚类 [${theme.id}: ${theme.title}]: ${check.rejectedReason}`);
```

#### `backend/node/extract-node.ts`
```typescript
L115: const plateSubject = matchPlate && matchPlate[1] ? `${matchPlate[1].replace(/\s+/g, "").toUpperCase()}车辆` : "";
L121: const location = subdistrict ? `${subdistrict}` : (district || "辖区");
L169: ? `模型支持工具调用，开始抽取 (共 ${rawTickets.length} 条)...`
L170: : `模型不支持工具调用，已回退 JSON 抽取 (共 ${rawTickets.length} 条)...`,
L211: stageText: `已恢复断点：跳过已抽取工单 ${preExtractedCount} 条，继续抽取剩余 ${normalizedRawTickets.length - preExtractedCount} 条...`,
L255: stageText: `AI 正在抽取工单实体与微观地点 (${currentProcessed} / ${normalizedRawTickets.length})...`,
L286: stageText: `二级 AI 仲裁复核中 (${completedArbitrations} / ${arbitrationTasks.length})...`,
L298: stageText: `触发二级 AI 仲裁机制，正在对 ${arbitrationTasks.length} 条低置信度/歧义工单进行事实复核纠偏...`,
L363: stageText: `要素抽取完成，识别低置信工单 ${lowConfidenceTickets.length} 条，准备执行图谱聚类...`,
```

#### `backend/node/summary-node.ts`
```typescript
L57: aiSummary: r.aiSummary || theme.aiSummary || `${theme.canonicalLocation || "辖区"}短时集中反映${theme.ticketCount}件“${theme.eventType}”诉求`,
L91: aiSummary: r.aiSummary || theme.aiSummary || `${theme.canonicalLocation || "辖区"}短时集中反映${theme.ticketCount}件“${theme.eventType}”诉求`,
L132: stageText: `正在对 ${enrichedThemes.length} 个多频主题进行批量深度公文研判与协同处置建议生成...`,
L168: stageText: `AI 正在生成公文级处置建议 (${Math.min(synthesizedCount, enrichedThemes.length)} / ${enrichedThemes.length})...`,
L182: stageText: `多频研判完成！已聚合 ${enrichedThemes.length} 个多频主题`,
```

#### `backend/prompt.ts`
```typescript
L22: .describe("精准事发微观地点（必须包含：法定镇街/街道 + 路段/巷号 + 具体门牌号/小区/地标，如：某街道某路3号门口）"),
L63: .describe("纠正后的微观地点（必须包含法定镇街/街道+具体路段门牌/小区，严禁编造不存在的区划）"),
L100: return `你是政务热线智能工单要素抽取专家。请对以下 ${tickets.length} 条工单精准提取主体、微观地点、事件类型、业务分类与置信度。
L108: 2. location（微观地点）：必须包含"法定镇街/街道 + 路段/小区 + 门牌/地标"（如"某街道某路三街2号门口"），镇街/街道必须属于上述法定白名单，严禁虚构或只填宽泛区名。
L120: `[${idx + 1}] 工单号: ${t.ticketNo} | 登记标题: ${desensitizeContent(t.title || "无")} | 登记辖区: ${t.subdistrict || "未指定"}
L137: return `你是政务 12345 疑难争议工单复核仲裁专家。首轮 AI 抽取置信度较低（${firstPass.confidence}分）或要素模糊。请结合诉求正文与目标辖区法定区划进行事实纠偏。
L200: return `你是政务热线智能研判与督办专家。请对以下多频诉求主题（共 ${theme.ticketCount} 件工单，跨度 ${theme.timeSpanHours}h）进行深度公文研判并输出处置建议。
L212: `  [${i + 1}] [${t.subdistrict || "本区"}] ${t.summarizeTitle || t.title}:
L250: return `你是政务热线智能研判与督办专家。请对以下 ${themes.length} 个多频诉求主题进行批量深度公文研判，输出各主题的风险评级、归因分析、全貌综述与精准处置建议（必须明确牵头部门/科室、响应时限及具体办理路径）。
L256: return `=== [${idx + 1}] 主题 ID: ${theme.id} ===
L259: - 样例: ${sampleTickets.map((t) => `(${t.subdistrict || "本区"}) ${t.summarizeTitle || t.title}`).join("；")}`;
L265: themeIndex 与 [1]..[${themes.length}] 一一对应。`;
L288: `${idx + 1}. 【${t.riskLevel}】${t.title}（${t.ticketCount}单，${t.canonicalLocation}，建议：${t.recommendedAction}）`
```

#### `backend/theme-metrics.ts`
```typescript
L57: "建议现场核查 + 源头治理，避免问题反复出现",
L135: { name: "关键词命中", pct: keywordPct, desc: event ? `主题「${event}」覆盖 ${keywordHits}/${n}` : "无统一事件类型" },
L136: { name: "地理范围", pct: geoPct, desc: loc ? `落在同一地点 ${locHits}/${n}` : "地点未对齐" },
L137: { name: "时间模式", pct: timePct, desc: `跨度约 ${Math.max(1, Math.round(spanHours))} 小时` },
L138: { name: "情绪强度", pct: moodPct, desc: moodHits ? `险情/激烈用语 ${moodHits} 条` : "未命中险情词" },
```

#### `lib/civic-dto.ts`
```typescript
L97: { name: "空间聚集度", pct: theme.patternType === "DIVERGE" ? 84 : 95, desc: `同属${theme.canonicalLocation || "辖区"}物理半径` },
L129: : `${sampleTowns.slice(0, 2).join(" · ")} 等 ${sampleTowns.length} 镇街`
```

#### `lib/civic-queries.ts`
```typescript
L28: return timeWindow(`近${days}天`, clampTimeRef(latest));
```

#### `lib/civic-stats.ts`
```typescript
L264: title: gatherTheme.title || `${gatherTheme.canonicalLocation || "辖区"} · ${gatherTheme.category || "民生"}诉求聚集`,
L265: text: gatherTheme.aiSummary || gatherTheme.recommendedAction || `${gatherTheme.canonicalLocation || "辖区"}出现 ${gatherTheme.ticketCount || 0} 件${gatherTheme.category || ""}相关诉求`,
L280: title: divergeTheme.title || `${divergeTheme.canonicalSubject || "涉事主体"} 多类型问题发散`,
L281: text: divergeTheme.aiSummary || divergeTheme.recommendedAction || `涉及同一主体共 ${divergeTheme.ticketCount || 0} 件诉求`,
L297: title: repeatOrUrgentTheme.title || `${repeatOrUrgentTheme.canonicalSubject || "重点区域"} 多次重复诉求`,
L298: text: repeatOrUrgentTheme.aiSummary || repeatOrUrgentTheme.recommendedAction || `累计产生 ${repeatOrUrgentTheme.ticketCount || 0} 次高频反映`,
L313: title: fourthTheme.title || `${fourthTheme.canonicalLocation || "属地片区"} · ${fourthTheme.category || "民生"}集中研判`,
L314: text: fourthTheme.aiSummary || fourthTheme.recommendedAction || `${fourthTheme.canonicalLocation || "辖区"}汇聚 ${fourthTheme.ticketCount || 0} 件工单`,
```

#### `lib/mock-data.ts`
```typescript
L1887: "content": "市民于2024年11月9日租住了凯普公寓（顺德区乐从镇天佑城B座凯普酒店公寓）短租房，金额：2660元（包含押金）+1605元，于2024年12月29日截止，市民缴清了最后几天的房租和水电费，但房东又另外扣了433元金额，房东表示不再退给市民，故市民希望相关部门介入要求酒店退回433元费用处理。",
L1959: "content": "市民父亲（陈树敏，身份证：********）在佛山市顺德区保安服务有限公司陈村分公司工作（工作地址：顺德区陈村镇锦龙居委会锦绣新村锦绣一路29号，单位负责人：周光明，联系电话：无法提供），市民表示单位于2024年12月31日通知市民父亲不需再上班，单位拒绝协商，市民认为单位是恶意解雇其父亲，双方沟通无果，市民现希望部门介入，要求单位根据劳动法的规定出具辞退通知书，支付其父亲恶意解雇的经济赔偿金n+1。（市民表示部门有需要可联系市民获取委托书）",
```

#### `lib/task-progress.ts`
```typescript
L251: error: `任务卡死自动清扫(${STALE_RUNNING_THRESHOLD_MS / 60_000} 分钟无更新,容器可能异常退出)`,
```

#### `lib/ticket-ingest.ts`
```typescript
L196: console.error(`[ingest] chunk ${i}-${i + BATCH_SIZE} 失败:`, dbErr?.message || dbErr);
```

#### `lib/vocabulary.ts`
```typescript
L322: return `【${targetVocab.cityName}${targetVocab.regionName}法定区划/街道】：${townNames}
L323: 【法定民生分类】：${catNames}`;
```

#### `app/api/admin/regions/[id]/route.ts`
```typescript
L50: return apiSuccess({ id }, `已成功销毁站点 [${id}]`);
```

#### `app/api/admin/regions/[id]/seed-vocab/route.ts`
```typescript
L24: console.log(`[seed-vocab] 开始为 [${schemaName}] 导入 ${townships.length} 个镇街, ${departments.length} 个部门...`);
L128: ${`民生核心分类: ${c.category}`},
```

#### `app/api/admin/regions/ai-scout/route.ts`
```typescript
L84: 请全面列出【${province} ${city} ${district}】所有的法定街道/镇（例如广州天河区包含 21 条街道，海珠区包含 18 条街道，越秀区包含 18 条街道，必须全量、真实准确！）。`;
```

#### `app/api/admin/regions/route.ts`
```typescript
L94: `成功初始化地区站点 [${name}]`
```

#### `app/api/tickets/paste/route.ts`
```typescript
L35: return apiError(ApiCode.FILE_SIZE_EXCEEDED, `单次粘贴最多 ${MAX_LINES} 条,当前 ${texts.length} 条`, 400);
```

#### `app/api/tickets/route.ts`
```typescript
L123: message: `处理完成: 成功入库 ${insertedCount} 条，重复过滤 ${duplicateCount} 条，异常格式 ${failedCount} 条`,
```

## 二、重点排查：规则与判断死逻辑 (28 处)

#### `backend/node/canonical-node.ts`
```typescript
L8: const match = name.match(/([粤京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][\s]?[A-Z0-9]{4,6}[A-Z0-9挂学警港澳]?)/i);
```

#### `backend/node/cluster-validator.ts`
```typescript
L38: const plateMatch = subject.match(/([粤京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][\s]?[A-Z0-9]{4,6})/i);
L43: const tPlateMatch = tSubj.match(/([粤京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][\s]?[A-Z0-9]{4,6})/i);
L65: const isMultiSiteEntity = /(?:公司|集团|网点|分行|专卖|连锁|医院|学校|中心|局|所|队)$/.test(subject) || subject.length >= 6;
```

#### `backend/node/extract-node.ts`
```typescript
L114: const matchPlate = content.match(/(?:车牌[号为：:\s]*|小车|车辆|车牌[：:\s]*)([粤京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][\s]?[A-Z0-9]{4,6}[A-Z0-9挂学警港澳]?)/);
```

#### `backend/theme-metrics.ts`
```typescript
L77: .filter((s) => s && s !== "市民*" && s !== "热线市民")
```

#### `lib/admin-area.ts`
```typescript
L32: if (/未提供|具体|等多处|未标明|未归属|所属|地址/.test(text)) return false;
L60: if (suffix === "区") {
L80: if (!tail || tail === "乡") continue;
L82: if (full === "乡镇") continue;
```

#### `lib/civic-dto.ts`
```typescript
L28: if (label === "已办结" || label === "RESOLVED") return "#52C41A";
L29: if (label === "处置中" || label === "IN_PROGRESS") return "#1677FF";
L99: { name: "情绪敏感度", pct: theme.riskLevel === "HIGH" ? 90 : 75, desc: "群众切身民生利益诉求" },
L100: { name: "主体一致性", pct: theme.patternType === "DIVERGE" ? 98 : 92, desc: "指向相同涉事主体或处置单位" },
L123: .filter((r) => r && r !== "未归属")
```

#### `lib/civic-queries.ts`
```typescript
L358: if (label === "已办结") return 0;
L359: return pendingByTheme.get(t.id) ?? Math.round((t.ticketCount || 0) * (label === "处置中" ? 0.4 : 0.7));
L372: label === "已办结"
L374: : pendingByTheme.get(t.id) ?? Math.round(base.count * (label === "处置中" ? 0.4 : 0.7));
L404: if (q.tab === "pending") next = next.filter((c) => c.status.label === "未处理");
L405: else if (q.tab === "progress") next = next.filter((c) => c.status.label === "处置中");
L406: else if (q.tab === "done") next = next.filter((c) => c.status.label === "已办结");
```

#### `lib/civic-stats.ts`
```typescript
L311: tag: fourthTheme.patternType === "DIVERGE" ? "发散" : "聚集",
L312: tone: fourthTheme.category === "公共安全" ? "danger" : fourthTheme.category === "市场监管" ? "info" : "warning",
```

#### `lib/civic-time.ts`
```typescript
L24: const near = key.match(/^近(\d+)天$/);
L61: if (!key || key === "全部") return true;
```

#### `lib/ticket-ingest.ts`
```typescript
L86: normalized[mappedKey] = typeof v === "string" ? v.replace(/12345/g, "市民服务热线") : v;
L114: ? closureRaw.includes("重开") || closureRaw.toUpperCase() === "REOPENED"
```

## 三、默认兜底与回退中文 (67 处)

#### `backend/node/cluster-node.ts`
```typescript
L106: const eventType = tickets[0].eventType || "多频诉求跟进";
L199: const eventType = tickets[0].eventType || "区域集中诉求";
```

#### `backend/node/extract-node.ts`
```typescript
L55: category: item.category || "城市管理",
L83: category: item.category || "城市管理",
L98: result.set(globalIdx, fallbackDynamicExtraction(ticket, vocab?.categories?.[0]?.category || "综合民生"));
L108: function fallbackDynamicExtraction(ticket: RawTicket, defaultCategory = "综合民生"): ExtractedTicketItem {
L118: const subject = plateSubject || "涉事方";
L125: const eventType = ticket?.title || ticket?.sourceCategory || "民生诉求跟进";
L193: subject: ticket.title || fallback.subject || "相关主体",
L195: eventType: ticket.sourceCategory || fallback.eventType || "民生诉求",
L196: category: (ticket.sourceCategory as any) || fallback.category || "城市管理",
L313: canonicalizeCategory(aiExtracted?.category || fallback.category) || "城市管理";
```

#### `backend/node/summary-node.ts`
```typescript
L206: const topSubject = enrichedThemes[0]?.canonicalSubject || "暂无重点多频诉求";
```

#### `backend/prompt.ts`
```typescript
L145: - 登记标题：${desensitizeContent(ticket.title || "无")}
L146: - 登记辖区：${ticket.subdistrict || "未指定"}
```

#### `backend/rules.ts`
```typescript
L22: defaultCategory: "综合民生",
```

#### `lib/admin-area.ts`
```typescript
L79: const tail = raw.split(/[省市县旗区]/).pop() || "";
```

#### `lib/alias-dict.ts`
```typescript
L197: if (canonical.startsWith(alias) && (canonical.endsWith("街道") || canonical.endsWith("镇"))) {
L243: type: cleanCanonical.endsWith("街道") || cleanCanonical.endsWith("镇") ? "TOWNSHIP" : "ENTITY",
```

#### `lib/civic-dto.ts`
```typescript
L15: return raw.replace(/(街道|镇|乡|区|县)$/g, "") || "未归属";
L133: const type = theme.category || theme.eventType || "综合民生";
L154: label: theme.handlingStatus || "未处理",
L208: title: row.summarizeTitle || row.title || "市民诉求",
L209: category: row.sourceCategory || row.category || "综合民生",
L210: region: regionLabel(row.subdistrict, row.district) || "辖区",
L216: channel: row.channel || "市民服务热线",
```

#### `lib/civic-persist.ts`
```typescript
L88: title: clip(theme.title, 255) || "未命名主题",
L89: canonicalSubject: clip(theme.canonicalSubject, 255) || "相关主体",
L90: canonicalLocation: clip(theme.canonicalLocation, 255) || "本地辖区",
L91: eventType: clip(theme.eventType, 128) || "民生诉求",
L92: category: clip(theme.category, 64) || "城市管理",
L104: handlingStatus: clip(theme.handlingStatus, 16) || "未处理",
```

#### `lib/civic-queries.ts`
```typescript
L357: const label = t.handlingStatus || "未处理";
L370: const label = base.status.label || "未处理";
```

#### `lib/task-progress.ts`
```typescript
L164: stageText: r.stageText || "处理中...",
L207: stageText: r.stageText || "处理中...",
```

#### `lib/tenant/schema-manager.ts`
```typescript
L241: ${params.province || "广东省"},
```

#### `lib/ticket-ingest.ts`
```typescript
L102: const channel = normalized.channel || normalized.sourceChannel || "市民服务热线";
L125: citizenName: normalized.citizenName || "热线市民",
```

#### `lib/vocabulary.ts`
```typescript
L135: provinceName: parsed.province || "广东省",
L216: category: meta.category || "城市管理",
L229: regionName: region?.name || "本地辖区",
L230: cityName: region?.city || "本地城市",
L231: provinceName: region?.province || "广东省",
```

#### `app/api/admin/regions/[id]/seed-vocab/route.ts`
```typescript
L104: ${JSON.stringify({ category: d.category || "城市管理" })},
```

#### `app/api/admin/regions/route.ts`
```typescript
L74: province: (province || "广东省").trim(),
L89: province: province || "广东省",
```

#### `app/api/cluster/route.ts`
```typescript
L66: citizenName: r.citizenName || "热线市民",
L70: channel: r.channel || "市民服务热线",
L119: topSubject: result.themes[0]?.canonicalSubject || "暂无重点多频诉求",
```

#### `app/api/dict/route.ts`
```typescript
L40: type: canonical.endsWith("街道") || canonical.endsWith("镇") ? "TOWNSHIP" : "ENTITY",
L117: const aliasType = type || (cleanCanonical.endsWith("街道") || cleanCanonical.endsWith("镇") ? "TOWNSHIP" : "ENTITY");
```

#### `app/api/stats/route.ts`
```typescript
L53: topSubject: themes[0]?.canonicalSubject || "暂无重点多频诉求",
```

#### `app/api/themes/[id]/tickets/route.ts`
```typescript
L50: citizenName: r.citizenName || "热线市民",
L51: district: r.district || "所属辖区",
L52: subdistrict: r.subdistrict || "未归属镇街",
L53: channel: r.channel || "市民服务热线",
L91: citizenName: r.citizenName || "热线市民",
L92: district: r.district || "所属辖区",
L93: subdistrict: r.subdistrict || "未归属镇街",
L94: channel: r.channel || "市民服务热线",
```

#### `app/api/themes/route.ts`
```typescript
L27: category: t.category || "城市管理",
```

#### `app/api/tickets/route.ts`
```typescript
L24: citizenName: r.citizenName || "市民*",
L27: channel: r.channel || "市民服务热线",
L70: title: t.title || "市民诉求",
L73: citizenName: t.citizenName || "市民*",
L77: channel: t.channel || "市民服务热线",
```

