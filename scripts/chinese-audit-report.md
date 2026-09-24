# 项目非注释代码中文审查全景报告

> 本报告由 `scripts/scan-chinese.ts` 自动生成，已过滤掉全部单行注释 (`//`)、块级注释 (`/* ... */`) 与 JSX 注释。

## 📊 统计汇总
- **扫描目录**: `backend/`, `lib/`, `app/`
- **涉及代码文件数**: 69 个
- **含非注释中文代码行**: 2373 行

### 分类分布与现状

| 类别 | 描述 | 出现行数 | 当前状态与治理结论 |
| :--- | :--- | :--- | :--- |
| **测试与演示工单样本** | `lib/mock-data.ts` 内置的历史工单正文与测试数据 | 1000 行 | 规范的离线/演示测试数据集，不影响生产算法逻辑 |
| **AI 提示词模板** | `backend/prompt.ts` 中统一收拢的专家提示词与 Few-Shot | 140 行 | 已彻底收拢至统一 Prompt 管理中心，入模变量动态注入 |
| **前端展示与表头文案** | `app/` 中 JSX 界面标题、按钮、图表轴标签 | 725 行 | 正常的前端用户界面展示文案，可渐进式对接 i18n 字典 |
| **标准状态码与多语言消息** | `lib/api-codes.ts` 中的统一状态码与响应消息 | 31 行 | 推荐架构：标准前后端同构 i18n 消息映射底座 |
| **中文拼装模板** | 字符串插值拼接（如 `微观地点【${loc}】...集中出现`） | 120 行 | 关键部分已由 LLM 真实生成替换，剩余主要是日志与控制台提示 |
| **规则与判断死逻辑** | 代码流程中的特定中文词比较与正则分支 | 42 行 | 已由原本 65 处大幅缩减至 42 处（主要为全国车牌正则与标准行政后缀） |
| **默认兜底中文** | 缺省回退词（如 `|| "辖区"`） | 100 行 | 已剥离具体区域专属词，统一使用通用兜底 |
| **其他常量** | 各类未归类配置常量与类型注解 | 215 行 | 均为常规静态配置 |

## 一、核心排查：规则与判断逻辑 (42 处)

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

#### `lib/admin-area.ts`
```typescript
L71: if (suffix === "区") {
L91: if (!tail || tail === "乡") continue;
L93: if (full === "乡镇") continue;
```

#### `lib/civic-dto.ts`
```typescript
L40: if (s === "RESOLVED" || s === "FINISHED" || s === "已办结" || s === "办结") return "RESOLVED";
L41: if (s === "IN_PROGRESS" || s === "PROCESSING" || s === "DISPATCHED" || s === "处置中" || s === "处理中") return "IN_PROGRESS";
L47: if (u === "URGENT" || u === "HIGH") return "紧急";
L48: if (u === "MEDIUM") return "较急";
L65: if (/(?:生态|环境|环保|河道|水污染)/.test(cat)) return "badge-pill--success";
L66: if (/(?:劳动|社保|劳资|欠薪|工伤)/.test(cat)) return "badge-pill--warning";
L67: if (/(?:市场|市监|消费|物价|欺诈)/.test(cat)) return "badge-pill--danger";
L68: if (/(?:城市|城管|市政|环卫|违建)/.test(cat)) return "badge-pill--info";
L69: if (/(?:交通|交警|出行|道路|拥堵)/.test(cat)) return "badge-pill--primary";
L70: if (/(?:安全|消防|燃气|应急)/.test(cat)) return "badge-pill--danger";
L140: { name: "情绪敏感度", pct: theme.riskLevel === "HIGH" ? 90 : 75, desc: "群众切身民生利益诉求" },
L141: { name: "主体一致性", pct: theme.patternType === "DIVERGE" ? 98 : 92, desc: "指向相同涉事主体或处置单位" },
L164: .filter((r) => r && r !== "未归属")
```

#### `lib/civic-stats.ts`
```typescript
L323: tag: fourthTheme.patternType === "DIVERGE" ? "发散" : "聚集",
```

#### `lib/civic-time.ts`
```typescript
L24: const near = key.match(/^(?:近|LAST_)?(\d+)(?:天|DAYS?|D)$/i);
L66: if (!key || key.toUpperCase() === "ALL" || key === "全部") return true;
```

#### `lib/ticket-ingest.ts`
```typescript
L114: ? closureRaw.includes("重开") || closureRaw.toUpperCase() === "REOPENED"
```

#### `app/_components/civic/civic-nav.tsx`
```typescript
L162: {(session.user as any).role === "admin" ? "管理员" : "经办员"}
```

#### `app/_components/dashboard/upload-dialog.tsx`
```typescript
L1066: {ingestTab === "file" ? "上传并流式入库" : "粘贴文本入库"}
```

#### `app/_components/table/ticket-detail-sheet.tsx`
```typescript
L167: {selectedTicketIds.size === tickets.length ? "取消全选" : "全选全部"}
L279: {ticket.citizenPhone && !ticket.citizenPhone.includes("****") ? ticket.citizenPhone : "未预留电话"}
```

#### `app/multifreq/page.tsx`
```typescript
L113: const pending = filtered.filter((r) => r.status.code ? r.status.code === "PENDING" : r.status.label === "未处理");
L353: {top5.length === 0 && <div className="empty-hint">暂无多频群组。请先启动 Agent 研判。</div>}
```

#### `app/page.tsx`
```typescript
L200: <div className="insight-card__icon">{(c as any).type === "GATHERING" || c.tag === "聚集" ? "🚨" : (c as any).type === "REPEAT" || c.tag === "重复" ? "🔁" : (c as any).type === "DIVERGE" || c.tag === "发散" ? "📍" : "📉"}</div>
L255: {regions.length === 0 && <div className="empty-hint">暂无镇街分布。上传后请启动 Agent 研判，镇街由模型从微观地点切分。</div>}
```

#### `app/themes/[id]/page.tsx`
```typescript
L244: if (i === 4 && (row?.status?.code === "RESOLVED" || row?.status?.label === "已办结" || progress >= 100)) return row?.status?.eta || row?.last_date || "—";
L263: `==================== 关联成员工单列表 ====================`,
L600: {(row.features || []).length === 0 && <div className="empty-hint">暂无特征（尚未落库）</div>}
```

#### `app/themes/page.tsx`
```typescript
L91: const code = r.status.code || (r.status.label === "已办结" ? "RESOLVED" : r.status.label === "处置中" ? "IN_PROGRESS" : "PENDING");
L336: const sCls = g.status.code === "RESOLVED" || g.status.label === "已办结" ? "status-tag--done" : g.status.code === "IN_PROGRESS" || g.status.label === "处置中" ? "status-tag--progress" : "status-tag--pending";
L404: {filtered.length === 0 && <div className="empty-hint">暂无群组。请先触发聚类研判。</div>}
```

#### `app/tickets/page.tsx`
```typescript
L368: {data.data.length === 0 && <div className="empty-hint">暂无工单</div>}
L482: if (code === "RESOLVED") return "已办结";
L483: if (code === "IN_PROGRESS") return "处理中";
```

## 二、核心排查：字符串拼装逻辑 (120 处)

#### `backend/node/cluster-node.ts`
```typescript
L66: stageText: `正在构建多频知识图谱连通子图 (输入 ${enrichedTickets.length} 条已富化工单)...`,
L145: ? `办结${RULES.fakeClosure.windowDays}天内再次诉求（${reopenCount}次）`
L146: : `同一主体短时高频反映（${tickets.length}件）`,
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
L132: stageText: `正在对 ${enrichedThemes.length} 个多频主题进行批量深度公文研判与协同处置建议生成...`,
L168: stageText: `AI 正在生成公文级处置建议 (${Math.min(synthesizedCount, enrichedThemes.length)} / ${enrichedThemes.length})...`,
L182: stageText: `多频研判完成！已聚合 ${enrichedThemes.length} 个多频主题`,
```

#### `backend/theme-metrics.ts`
```typescript
L57: "建议现场核查 + 源头治理，避免问题反复出现",
L137: { name: "关键词命中", pct: keywordPct, desc: event ? `主题「${event}」覆盖 ${keywordHits}/${n}` : "无统一事件类型" },
L138: { name: "地理范围", pct: geoPct, desc: loc ? `落在同一地点 ${locHits}/${n}` : "地点未对齐" },
L139: { name: "时间模式", pct: timePct, desc: `跨度约 ${Math.max(1, Math.round(spanHours))} 小时` },
L140: { name: "情绪强度", pct: moodPct, desc: moodHits ? `险情/激烈用语 ${moodHits} 条` : "未命中险情词" },
```

#### `lib/civic-dto.ts`
```typescript
L138: { name: "空间聚集度", pct: theme.patternType === "DIVERGE" ? 84 : 95, desc: `同属${theme.canonicalLocation || "辖区"}物理半径` },
L170: : `${sampleTowns.slice(0, 2).join(" · ")} 等 ${sampleTowns.length} 镇街`
```

#### `lib/civic-queries.ts`
```typescript
L28: return timeWindow(`近${days}天`, clampTimeRef(latest));
```

#### `lib/civic-stats.ts`
```typescript
L273: title: gatherTheme.title || `${gatherTheme.canonicalLocation || "辖区"} · ${gatherTheme.category || "民生"}诉求聚集`,
L274: text: gatherTheme.aiSummary || gatherTheme.recommendedAction || `${gatherTheme.canonicalLocation || "辖区"}出现 ${gatherTheme.ticketCount || 0} 件${gatherTheme.category || ""}相关诉求`,
L290: title: divergeTheme.title || `${divergeTheme.canonicalSubject || "涉事主体"} 多类型问题发散`,
L291: text: divergeTheme.aiSummary || divergeTheme.recommendedAction || `涉及同一主体共 ${divergeTheme.ticketCount || 0} 件诉求`,
L308: title: repeatOrUrgentTheme.title || `${repeatOrUrgentTheme.canonicalSubject || "重点区域"} 多次重复诉求`,
L309: text: repeatOrUrgentTheme.aiSummary || repeatOrUrgentTheme.recommendedAction || `累计产生 ${repeatOrUrgentTheme.ticketCount || 0} 次高频反映`,
L325: title: fourthTheme.title || `${fourthTheme.canonicalLocation || "属地片区"} · ${fourthTheme.category || "民生"}集中研判`,
L326: text: fourthTheme.aiSummary || fourthTheme.recommendedAction || `${fourthTheme.canonicalLocation || "辖区"}汇聚 ${fourthTheme.ticketCount || 0} 件工单`,
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
L324: return `【${targetVocab.cityName}${targetVocab.regionName}法定区划/街道】：${townNames}
L325: 【法定民生分类】：${catNames}`;
```

#### `app/_components/civic/civic-charts.tsx`
```typescript
L124: return `${parseInt(m, 10)}月${parseInt(d, 10)}日`;
L232: `<b>${p.name}</b><br/>${Number(p.value).toLocaleString("zh-CN")} 件 (${Number(p.percent).toFixed(1)}%)`,
L422: title={`${r} × ${c}：${n ? n.toLocaleString("zh-CN") + " 件" : "暂无工单"}`}
```

#### `app/_components/civic/civic-map.tsx`
```typescript
L243: title={`诉求密度: ${count}`}
```

#### `app/_components/civic/civic-nav.tsx`
```typescript
L59: {activeRegion ? `${activeRegion.name} ` : ""}12345 AI 智能研判系统
```

#### `app/_components/civic/civic-workflow.tsx`
```typescript
L99: ? `当前 ${ticketStatus.total} 条工单已全部研判完毕，无需重复执行`
L117: toast.info(`当前 ${ticketStatus.total} 条工单已全部研判完毕，无需重复执行`);
```

#### `app/_components/civic/region-context.tsx`
```typescript
L73: toast.success(`已切换至【${target.city} · ${target.name} 12345 站点】`);
```

#### `app/_components/civic/video-modal.tsx`
```typescript
L33: desc: "183+ 多频主题群组智能聚类、一键折叠详情、实体拓扑与公文级处置建议",
```

#### `app/_components/copilot/light-copilot.tsx`
```typescript
L58: content: `您好！我是 **民声智理 12345 智能研判副驾驶**。\n\n当前已全量接入 **${stats.totalTickets.toLocaleString()}** 件工单，系统识别出 **${stats.themeCount}** 个多频治理主题，其中包含 **${stats.highRiskCount}** 项紧急督办事件。\n\n您可以随时让我生成研判简报、查找高危事件或分析特定街道的重点责任主体。`,
L190: ? { ...m, content: m.content || `研判失败:${msg || "未知错误"}` }
```

#### `app/_components/dashboard/upload-dialog.tsx`
```typescript
L167: toast.success(`后端解析入库完成！共处理 ${json.data.totalParsed} 条工单`);
L172: toast.error(`上传入库失败: ${errorText}`);
L177: toast.error(`网络或处理异常: ${err.message}`);
L193: toast.info(`正在将 ${texts.length} 条粘贴文本提交后端入库...`);
L207: toast.success(`粘贴入库完成！共处理 ${json.data.totalParsed} 条工单`);
L212: toast.error(`粘贴入库失败: ${errorText}`);
L217: toast.error(`网络或处理异常: ${err.message}`);
L308: stageText: `研判完成！已聚合 ${clusterJson.data.themes.length} 个多频主题`,
L314: toast.success(`Agent 研判完成！已生成 ${clusterJson.data.themes.length} 个多频治理主题！`);
L332: toast.error(`Agent 研判异常: ${err.message}`);
```

#### `app/_components/table/data-table.tsx`
```typescript
L150: 第 {table.getState().pagination.pageIndex + 1} 页 / 共{" "}
```

#### `app/_components/table/ticket-detail-sheet.tsx`
```typescript
L71: toast.success(`已导出主题「${theme.title}」下工单明细！`);
L76: toast.success(`已成功批量核查确认 ${count} 件多频工单，已生成协同督办派单流转记录！`);
```

#### `app/admin/regions/page.tsx`
```typescript
L151: `AI 成功梳理出 ${data.data.townships.length} 个法定镇街与 ${data.data.departments?.length || 0} 个协同职能部门！`
L202: toast.success(`🎉 站点【${scoutForm.city} · ${scoutForm.district}】纳管初始化完毕！`);
L228: toast.success(`已将【${region.name}】设为全局默认站点`);
L248: toast.success(`已成功销毁站点【${deletingRegion.name}】及其物理 Schema`);
L294: toast.success(`SVG 行政地图已成功绑定至【${uploadModalRegion.name}】`);
L374: sub={`物理空间: ${activeRegion?.schemaName || "未选择"}`}
L381: sub={`${totalThemes} 个治理主题 / ${totalVocab} 条词典`}
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

#### `app/dict/page.tsx`
```typescript
L124: { key: "townships", label: `${activeRegion ? activeRegion.name : ""} ${stats.townshipCount} 大法定镇街区划` },
L125: { key: "categories", label: `${stats.categoryCount} 大民生诉求分类标准` },
L227: {activeRegion ? `${activeRegion.city} · ${activeRegion.name}` : "当前辖区"}{" "}
L262: sub={`${townships.slice(0, 4).map((t) => t.name).join("/") || "辖区镇街"} 等 ${stats.townshipCount} 个辖区`}
L276: sub={`${stats.categoryCount} 大法定标准业务大类`}
```

#### `app/multifreq/page.tsx`
```typescript
L342: {c.communities ? `${c.communities} 个` : `${Math.max(1, Math.ceil(c.count / 3))} 个`}
L397: setTimeLabel(`近 ${windowDays} 天`);
```

#### `app/page.tsx`
```typescript
L88: toast.success(`已导出 ${list.length} 个群组`);
L111: {activeRegion ? `${activeRegion.city} · ${activeRegion.name}` : "当前辖区"} · 接口正常 · {ov?.dateRange || "全部时间"} · 实时研判
L159: sub={ov?.totalDays ? `${ov.totalDays} 天` : "--"}
L167: sub={maxDaily ? `最高 ${maxDaily.toLocaleString("zh-CN")}` : ov?.topRegion ? `最多 ${ov.topRegion}` : ""}
L217: <div className="card__title">{daysRange === 0 ? "全周期" : `${daysRange} 天`}工单量与多频群组新增趋势</div>
```

#### `app/themes/[id]/page.tsx`
```typescript
L252: `【${regionName} 12345 热线多频诉求智能研判报告】`,
L253: `群组编号: ${row.code || row.id}`,
L254: `归属辖区: ${row.region} · 诉求领域: ${row.type}`,
L255: `研判模式: ${meta.name}（${meta.tagline}）`,
L256: `整合工单: ${row.count} 件`,
L257: `时空脉络: ${row.first_date || "—"} 至 ${row.last_date || "—"}（跨度 ${days} 天）`,
L258: `AI 聚类置信度: ${row.ai_confidence ?? "—"}%`,
L259: `当前处置状态: ${row.status?.label || "未处理"} (进度 ${row.status?.progress ?? 0}%)`,
L260: `牵头承办部门: ${row.status?.owner || `${regionName}热线督办组`}`,
L261: `协同处置建议: ${row.mode_advice || meta.rule}`,
... 其余 10 处省略
```

#### `app/themes/page.tsx`
```typescript
L140: toast.success(`已导出 ${filtered.length} 个群组`);
L149: {activeRegion ? `${activeRegion.name} · ` : ""}AI 识别的多频工单群组 · 每行为一个群组，包含多条关联工单
```

#### `app/tickets/[id]/page.tsx`
```typescript
L82: 所属主题：{row.cluster_info?.title || `${row.region} · ${row.category}`}
```

#### `app/tickets/page.tsx`
```typescript
L129: toast.success(`已导出本页 ${data.data.length} 条`);
L140: {activeRegion ? `${activeRegion.name} · ` : ""}全部工单 · 实时同步 · 共 <b style={{ color: "var(--c-ink)" }}>{s.total}</b> 条
L188: sub={`占总数 ${pendingShare}%`}
L200: sub={`办结率 ${finishShare}%`}
```

