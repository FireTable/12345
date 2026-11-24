/**
 * 副驾驶开场、工具协议和流式状态。不连数据库，也不调用模型。
 */
import {
  COPILOT_OFFLINE_TEXT,
  buildCopilotSystemPrompt,
  copilotGreeting,
  createCopilotStreamExtractor,
  formatCopilotStatus,
  formatCopilotStatuses,
  getCopilotToolCalls,
  parseCopilotTurn,
  splitCopilotStream,
} from "../lib/copilot-protocol";

function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${message}`);
  }
}

const greeting = copilotGreeting({ city: "广州市", name: "天河区" });
assert(greeting.includes("广州市 · 天河区"), "开场写明当前区");
assert(!greeting.includes("件工单") && !greeting.includes("个多频"), "开场不预告工单数和主题数");

const tool = parseCopilotTurn(
  '{"action":"tool","name":"search_tickets","args":{"query":"大良噪音"}}'
);
assert(tool.type === "tool" && tool.name === "search_tickets", "解析工单检索调用");
assert(tool.type === "tool" && tool.args.query === "大良噪音", "保留检索词");

const fenced = parseCopilotTurn('```json\n{"action":"tool","name":"get_theme","args":{"themeId":"THEME-12"}}\n```');
assert(fenced.type === "tool" && fenced.name === "get_theme", "代码围栏里的工具调用仍然能解析");

const prose = parseCopilotTurn("天河区今天的噪音投诉需要再核实。后面如果出现 { 也不当工具。");
assert(prose.type === "answer" && prose.text.includes("天河区"), "普通正文不误判成工具");

const unknown = parseCopilotTurn('{"action":"tool","name":"drop_database","args":{}}');
assert(unknown.type === "answer", "不认识的工具不会执行");

const offline = parseCopilotTurn('{"fallback":true,"message":"offline"}');
assert(offline.type === "answer" && offline.text === COPILOT_OFFLINE_TEXT, "模型离线时给固定说明，不把兜底 JSON 甩给用户");

const answer = parseCopilotTurn('{"action":"answer","text":"**大良**有 3 条相近工单。"}');
assert(answer.type === "answer" && answer.text === "**大良**有 3 条相近工单。", "回答 JSON 只取出正文");

const thought = parseCopilotTurn("<think>先查向量</think>");
assert(thought.type === "answer" && thought.text === "", "思考块不进答复");

const prompt = buildCopilotSystemPrompt("广州市 · 顺德区", true);
assert(prompt.includes("广州市 · 顺德区"), "系统提示锁定当前区");
assert(prompt.includes("search_tickets") && prompt.includes("list_townships"), "系统提示列出检索工具");
assert(!prompt.includes("重点主题摘要"), "系统提示不再塞入主题清单");

const locked = buildCopilotSystemPrompt("广州市 · 天河区", false);
assert(locked.includes("禁止再调用工具"), "检索次数用完后只许作答");

const status = formatCopilotStatus("search_tickets");
const split = splitCopilotStream(`${status}找到 2 条`);
assert(split.status === "正在按语义检索工单" && split.text === "找到 2 条", "状态行从正文里拆出去");

// M5: multi-tool protocol
const multiTools = parseCopilotTurn(
  '{"action":"tools","calls":[{"name":"region_overview","args":{}},{"name":"list_townships","args":{}},{"name":"region_overview","args":{}},{"name":"drop_database","args":{}}]}'
);
assert(
  multiTools.type === "tools" && multiTools.calls.length === 2,
  "多工具 calls 去重并过滤未知工具"
);
assert(
  getCopilotToolCalls(multiTools).map((c) => c.name).join(",") === "region_overview,list_townships",
  "getCopilotToolCalls 提取全部并行工具"
);

const singleFromTools = parseCopilotTurn(
  '{"action":"tools","calls":[{"name":"category_stats","args":{}}]}'
);
assert(singleFromTools.type === "tool" && singleFromTools.name === "category_stats", "单元素 calls 归一化为单工具");

const cappedTools = parseCopilotTurn(
  JSON.stringify({
    action: "tools",
    calls: [
      { name: "region_overview", args: {} },
      { name: "list_townships", args: {} },
      { name: "category_stats", args: {} },
      { name: "search_themes", args: { limit: 5 } },
      { name: "list_agent_tasks", args: { limit: 5 } },
    ],
  })
);
assert(cappedTools.type === "tools" && cappedTools.calls.length === 4, "单轮并行工具上限为 4 个");

const truncatedMulti = parseCopilotTurn(
  '{"action":"tools","calls":[{"name":"region_overview","args":{}},{"name":"list_townships","args":{}},{"name":"category_stats","args":{"broken"'
);
assert(
  truncatedMulti.type === "tools" && truncatedMulti.calls.length === 2,
  "截断的多工具 JSON 能恢复已完成的前两个调用"
);

const multiStatus = formatCopilotStatuses(["region_overview", "list_townships", "region_overview"]);
const splitMulti = splitCopilotStream(`${multiStatus}已查到`);
assert(
  splitMulti.status === "正在统计本区 · 正在统计镇街" && splitMulti.text === "已查到",
  "formatCopilotStatuses 合并去重并行状态并兼容 splitCopilotStream"
);

assert(
  !locked.includes('{"action":"answer"') && locked.includes("Markdown"),
  "allowTools=false 时直接要求 Markdown 输出，不再包 JSON"
);

// M5: createCopilotStreamExtractor
{
  const ex = createCopilotStreamExtractor();
  const payload = '{"action":"answer","text":"你好\\n\\"世界\\"\\\\\\u4e2d"}';
  const deltas: string[] = [];
  for (const ch of payload) {
    const d = ex.push(ch);
    if (d) deltas.push(d);
  }
  const fl = ex.flush();
  if (fl.emitted) deltas.push(fl.emitted);
  assert(
    deltas.length > 5 && deltas.join("") === '你好\n"世界"\\中',
    "StreamExtractor 逐字符实时反转义 JSON answer.text"
  );
}
{
  const ex = createCopilotStreamExtractor();
  let out = "";
  for (const ch of '{"action":"tool","name":"search_tickets","args":{"query":"test"}}') {
    out += ex.push(ch);
  }
  out += ex.flush().emitted;
  assert(out === "", "StreamExtractor 对 tool JSON 零正文输出");
}
{
  const ex = createCopilotStreamExtractor();
  let out = "";
  for (const ch of '{"action":"tools","calls":[{"name":"region_overview","args":{}}]}') {
    out += ex.push(ch);
  }
  out += ex.flush().emitted;
  assert(out === "", "StreamExtractor 对 tools JSON 零正文输出");
}
{
  const ex = createCopilotStreamExtractor();
  const md = "## 标题\n\n正文\n\n```civic-action\n{\"themeId\":\"TH-1\",\"action\":\"DISPATCH\"}\n```";
  const d1 = ex.push(md.slice(0, 10));
  const d2 = ex.push(md.slice(10));
  const d3 = ex.flush().emitted;
  assert(d1.length > 0 && d1 + d2 + d3 === md, "StreamExtractor 对纯 Markdown + civic-action 立即透传");
}
{
  const ex1 = createCopilotStreamExtractor();
  const out1 =
    ex1.push("<thi") +
    ex1.push("nk>思考中</thi") +
    ex1.push("nk>\n{\"action\":\"answer\",\"text\":\"正文\"}") +
    ex1.flush().emitted;
  assert(out1 === "正文", "StreamExtractor 剥离跨 chunk think 后提取 JSON 正文");

  const ex2 = createCopilotStreamExtractor();
  const out2 =
    ex2.push("<think>推理</think>\n直接正文") + ex2.flush().emitted;
  assert(out2 === "直接正文", "StreamExtractor 剥离 think 后直接透传 Markdown 正文");
}
{
  const ex = createCopilotStreamExtractor();
  const out = ex.push('{"fallback":true,"message":"offline"}') + ex.flush().emitted;
  assert(out === "", "StreamExtractor 抑制 fallback JSON，交由 parseCopilotTurn 输出离线提示");
}
// M5 Iteration 2 regressions: unescaped inner quotes + no-space/bare JSON fences
{
  const ex = createCopilotStreamExtractor();
  const payload = '{"action":"answer","text":"市民反映"噪音很大"请处理"}';
  let out = "";
  for (const ch of payload) {
    out += ex.push(ch);
  }
  out += ex.flush().emitted;
  assert(
    out === '市民反映"噪音很大"请处理',
    `StreamExtractor 容错流式输出 JSON text 内未转义双引号 (got: ${out})`
  );
}
{
  const ex = createCopilotStreamExtractor();
  const payload = '{"action":"answer","text":"他说"你好",然后走了","confidence":0.9}';
  let out = "";
  for (const ch of payload) {
    out += ex.push(ch);
  }
  out += ex.flush().emitted;
  assert(
    out === '他说"你好",然后走了',
    `StreamExtractor 区分未转义引号后的普通逗号与下一字段分隔 (got: ${out})`
  );
}
{
  const ex1 = createCopilotStreamExtractor();
  let out1 = "";
  for (const ch of '```json{"action":"answer","text":"无空格围栏"}```') {
    out1 += ex1.push(ch);
  }
  out1 += ex1.flush().emitted;
  assert(out1 === "无空格围栏", `StreamExtractor 支持无空格 \`\`\`json{...} 围栏 (got: ${out1})`);

  const ex2 = createCopilotStreamExtractor();
  let out2 = "";
  for (const ch of '```\n{"action":"answer","text":"裸围栏你好"}\n```') {
    out2 += ex2.push(ch);
  }
  out2 += ex2.flush().emitted;
  assert(out2 === "裸围栏你好", `StreamExtractor 支持裸 \`\`\`\\n{...} 围栏 (got: ${out2})`);
}

// M5 Iteration 3 regressions: trailing key with whitespace before colon (Challenger Case 2g)
{
  const cases: Array<{ payload: string; expected: string; label: string }> = [
    {
      payload: '{"action":"answer","text":"你好", "extra" : "secret_leak"}',
      expected: "你好",
      label: "Case 2g: 后续字段冒号前有空格时不泄露 JSON 键值",
    },
    {
      payload: '{"action":"answer","text":"ok", "score" : 1}',
      expected: "ok",
      label: "Case 2g-score: 后续数值字段冒号前有空格时不泄露 JSON 键值",
    },
    {
      payload: '{"action":"answer","text":"引用\\"nested\\", \\"k\\":1结束"}',
      expected: '引用"nested", "k":1结束',
      label: "Case 2b: 转义嵌套引号与键值正常反转义",
    },
    {
      payload: '{"action":"answer","text":"引用"nested", "k":1结束"}',
      expected: '引用"nested',
      label: "Case 2i: 未转义嵌套引号遇到真实键值分隔时保持与 parseCopilotTurn 一致",
    },
  ];
  for (const c of cases) {
    const ex = createCopilotStreamExtractor();
    let streamed = "";
    for (const ch of c.payload) {
      streamed += ex.push(ch);
    }
    streamed += ex.flush().emitted;
    const parsed = parseCopilotTurn(c.payload);
    assert(
      streamed === c.expected && parsed.type === "answer" && parsed.text === c.expected,
      `${c.label} (streamed=${JSON.stringify(streamed)}, parsed=${JSON.stringify(parsed.type === "answer" ? parsed.text : "")})`
    );
  }

  // Truncated stream stopping right after trailing key quote + space before colon
  const truncEx = createCopilotStreamExtractor();
  let truncOut = "";
  for (const ch of '{"action":"answer","text":"你好", "extra" ') {
    truncOut += truncEx.push(ch);
  }
  truncOut += truncEx.flush().emitted;
  assert(truncOut === "你好", `截断于后续字段冒号前空格时不吐出残余键名 (got: ${truncOut})`);

  // M5 Iteration 4 regressions: createCopilotStreamExtractor + parseCopilotTurn parity on truncated tails & inner prose
  const parityCases: Array<{ payload: string; expected: string; label: string }> = [
    {
      payload: '{"action":"answer","text":"你好", "extra" ',
      expected: "你好",
      label: "Iter4 截断尾部 ' \"extra\" ' extractor/parser 一致不泄露残余键名",
    },
    {
      payload: '{"action":"answer","text":"你好", "extra',
      expected: "你好",
      label: "Iter4 截断尾部 ' \"extra' extractor/parser 一致不泄露残余键名",
    },
    {
      payload: '{"action":"answer","text":"你好", "',
      expected: "你好",
      label: "Iter4 截断尾部 ' \"' extractor/parser 一致不泄露引号",
    },
    {
      payload: '{"action":"answer","text":"你好",',
      expected: "你好",
      label: "Iter4 截断尾部 ',' extractor/parser 一致不泄露逗号",
    },
    {
      payload: '{"action":"answer","text":"你好", "extra":',
      expected: "你好",
      label: "Iter4 截断尾部 ' \"extra\":' extractor/parser 一致",
    },
    {
      payload: '{"action":"answer","text":"你好", "extra" : "',
      expected: "你好",
      label: "Iter4 截断尾部 ' \"extra\" : \"' extractor/parser 一致",
    },
    {
      payload: '{"action":"answer","text":"他说"你好", "extra" 是个词"}',
      expected: '他说"你好", "extra" 是个词',
      label: "Iter4 正文内含未转义引号与后续词组时仍完整保留正文",
    },
  ];
  for (const pc of parityCases) {
    const ex = createCopilotStreamExtractor();
    let streamed = "";
    for (const ch of pc.payload) {
      streamed += ex.push(ch);
    }
    streamed += ex.flush().emitted;
    const parsed = parseCopilotTurn(pc.payload);
    assert(
      streamed === pc.expected && parsed.type === "answer" && parsed.text === pc.expected,
      `${pc.label} (streamed=${JSON.stringify(streamed)}, parsed=${JSON.stringify(parsed.type === "answer" ? parsed.text : "")})`
    );
  }
}
