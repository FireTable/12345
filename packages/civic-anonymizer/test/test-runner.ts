import { anonymize, deanonymize } from "../src";

console.log("=== 正在运行 @civic/anonymizer 单元测试 ===");

// 测试用例 1：同一车牌多次出现（实体去重测试）
const text1 = "小车粤EY6501在顺德容桂建业西路违停，请部门尽快核查粤EY6501并通知车主挪车。";
const res1 = anonymize(text1);
console.log("\n▶ 测试 1（实体去重）：");
console.log("脱敏结果:", res1.text);
console.log("映射字典:", res1.keymap);
const countOfToken = (res1.text.match(/{{LICENSE_PLATE_1}}/g) || []).length;
console.log("Token 出现频次（应为2）:", countOfToken);
if (countOfToken !== 2) throw new Error("实体去重失败！");

// 复杂对象反向还原测试
const aiExtracted1 = {
  subject: "{{LICENSE_PLATE_1}}",
  action: "要求查处 {{LICENSE_PLATE_1}} 车辆",
};
const restored1 = deanonymize(aiExtracted1, res1.keymap);
console.log("大模型 JSON 还原后:", restored1);
if (restored1.subject !== "粤EY6501") throw new Error("JSON 还原失败！");

// 测试用例 2：二代身份证合法性校验（Checksum 算法测试）
const realId = "11010519491231002X"; // 合法测试校验码
const fakeId = "110105194912310029"; // 校验码错误（末位应为 X）
const text2 = `真实身份证：${realId}，随机长数字：${fakeId}`;
const res2 = anonymize(text2);
console.log("\n▶ 测试 2（国标身份证 Checksum 算法）：");
console.log("脱敏结果:", res2.text);
console.log("映射字典:", res2.keymap);
if (!res2.text.includes(fakeId)) throw new Error("假身份证/随机长数字不应被误脱敏！");
if (!res2.text.includes("{{ID_CARD_1}}")) throw new Error("真身份证应被精准脱敏！");

// 测试用例 3：公共设施与私密房号隔离测试
const text3 = "市民反映在大良街道云谷广场C5栋2601房云景商务公寓发生纠纷。";
const res3 = anonymize(text3);
console.log("\n▶ 测试 3（公共地点保留 vs 私密房号脱敏）：");
console.log("脱敏结果:", res3.text);
console.log("映射字典:", res3.keymap);
if (!res3.text.includes("大良街道云谷广场C5栋")) throw new Error("公共地名不应被破坏！");
if (!res3.text.includes("{{PRIVATE_ROOM_1}}")) throw new Error("私密房号必须被脱敏！");

// 测试用例 4：跨节点 SeedKeymap 状态继承测试
const round1 = anonymize("市民张三反映其手机 13800138000 收到骚扰电话。");
const round2 = anonymize("关于张三再次来电核实手机 13800138000 的进展。", {
  seedKeymap: round1.keymap,
});
console.log("\n▶ 测试 4（跨 Agent 节点 SeedKeymap 状态继承）：");
console.log("Round 1:", round1.keymap);
console.log("Round 2:", round2.keymap);
if (!round1.text.includes("市民{{PERSON_NAME_1}}") || round1.keymap["{{PERSON_NAME_1}}"] !== "张三") {
  throw new Error("无标点市民前缀人名 张三 必须被脱敏为 {{PERSON_NAME_1}}！");
}
if (round2.text.includes("{{PHONE_NUMBER_2}}")) throw new Error("继承后手机号不应变为 2！");

// 测试用例 5：全格式机动车号牌识别与边界防误伤
const platePositives = [
  "粤A·12345",
  "粤A-12345",
  "粤A•12345",
  "粤A 12345",
  "粤AD12345",
  "粤A1234学",
  "粤B5678港",
  "粤A·1234挂",
  "粤A12345挂",
  "京A·0001警",
  "粤Z1234澳",
];
for (const plate of platePositives) {
  const r = anonymize(`违停车辆为${plate}，请处置。`);
  if (!r.text.includes("{{LICENSE_PLATE_1}}") || r.keymap["{{LICENSE_PLATE_1}}"] !== plate) {
    throw new Error(`车牌格式未能精准脱敏: ${plate} -> ${JSON.stringify(r)}`);
  }
}
const plateNegatives = ["粤A1234", "粤B20250101"];
for (const nonPlate of plateNegatives) {
  const r = anonymize(`编号 ${nonPlate} 不是合法车牌。`);
  if (r.text.includes("{{LICENSE_PLATE_")) {
    throw new Error(`非法/过长编号不应误判为车牌: ${nonPlate} -> ${r.text}`);
  }
}

// 测试用例 6：单字姓称谓 + 无标点角色前缀人名 + 非人名负向护栏
const namePositives = [
  { input: "联系张先生核实", expected: "张先生" },
  { input: "李女士反映噪声", expected: "李女士" },
  { input: "王小姐投诉违建", expected: "王小姐" },
  { input: "市民张先生来电", expected: "张先生" },
  { input: "联系陈女士确认", expected: "陈女士" },
  { input: "市民张三称楼上漏水", expected: "张三" },
  { input: "投诉人李四的手机", expected: "李四" },
  { input: "业主王五称物业未整改", expected: "王五" },
  { input: "诉求人陈明反映路灯坏了", expected: "陈明" },
  { input: "当事人赵六表示同意", expected: "赵六" },
  { input: "反映人周某说垃圾未清", expected: "周某" },
  { input: "市民： 张三反映问题", expected: "张三" },
  { input: "市民陈明驾驶桂B·9988Z在路口逆行", expected: "陈明" },
];
for (const tc of namePositives) {
  const r = anonymize(tc.input);
  if (!r.text.includes("{{PERSON_NAME_1}}") || r.keymap["{{PERSON_NAME_1}}"] !== tc.expected) {
    throw new Error(`人名漏脱: "${tc.input}" 期望 "${tc.expected}" 实际 ${JSON.stringify(r)}`);
  }
}

const nameNegatives = [
  "老先生在公园散步",
  "好先生餐厅卫生较好",
  "贵公司小姐姐服务周到",
  "人家是千金小姐",
  "对方小姐不配合沟通",
  "那位小姐已经离开",
  "各位先生请注意安全",
  "市民反映路面坑洼",
  "投诉人表示满意",
  "业主委员会发布通知",
  "业主们一致反对",
  "市民向物业反映路灯故障",
  "市民于昨日致电热线",
  "市民通过热线反映情况",
  "业主房屋漏水严重",
  "市民马上反映情况",
  "市民周末反映噪音",
  "市民白天反映",
  "市民单独反映",
  "市民于上月反映问题",
  "市民能否解决",
  "市民周六投诉噪声",
  "单身女士反映路灯坏了",
  "老年群体咨询补助",
];
for (const neg of nameNegatives) {
  const r = anonymize(neg);
  if (r.text !== neg || Object.keys(r.keymap).length > 0) {
    throw new Error(`常规表述误脱敏: "${neg}" -> "${r.text}" (${JSON.stringify(r.keymap)})`);
  }
}

// 测试用例 7：无新 PII 时保留 seedKeymap
const cleanTextRes = anonymize("路面出现积水，暂无个人隐私。", { seedKeymap: round1.keymap });
if (
  cleanTextRes.keymap["{{PERSON_NAME_1}}"] !== "张三" ||
  cleanTextRes.keymap["{{PHONE_NUMBER_1}}"] !== "13800138000"
) {
  throw new Error("无新敏感实体时 anonymize 丢失了 seedKeymap！");
}

// 测试用例 8：deanonymize 特殊字符安全还原、Date/null 保留、循环引用防护、零输入篡改
const trickyKeymap = {
  "{{PERSON_NAME_1}}": '张"三\\n\t$& $1',
  "{{LICENSE_PLATE_1}}": "粤A·12345",
};
const trickyInput: Record<string, unknown> = {
  subject: "{{PERSON_NAME_1}}",
  nested: ["{{LICENSE_PLATE_1}}", null, 42],
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
};
const restoredTricky = deanonymize(trickyInput, trickyKeymap);
if (
  restoredTricky.subject !== '张"三\\n\t$& $1' ||
  (restoredTricky.nested as unknown[])[0] !== "粤A·12345" ||
  (restoredTricky.nested as unknown[])[1] !== null ||
  !(restoredTricky.createdAt instanceof Date) ||
  (restoredTricky.createdAt as Date).toISOString() !== "2026-10-01T00:00:00.000Z"
) {
  throw new Error(`deanonymize 特殊字符/类型还原失败: ${JSON.stringify(restoredTricky)}`);
}
if (trickyInput.subject !== "{{PERSON_NAME_1}}") {
  throw new Error("deanonymize 不得原地篡改输入对象！");
}
// 循环引用安全测试
const cyclic: Record<string, unknown> = { label: "{{LICENSE_PLATE_1}}" };
cyclic.self = cyclic;
const restoredCyclic = deanonymize(cyclic, trickyKeymap);
if (restoredCyclic.label !== "粤A·12345" || restoredCyclic.self !== restoredCyclic) {
  throw new Error("deanonymize 循环引用还原失败！");
}

// __proto__ 原型链安全防护测试
const protoPayload = JSON.parse(
  '{"__proto__":{"polluted":"{{PERSON_NAME_1}}"},"constructor":{"prototype":{"x":"{{LICENSE_PLATE_1}}"}},"safe":"{{PERSON_NAME_1}}"}'
) as Record<string, unknown>;
const restoredProto = deanonymize(protoPayload, trickyKeymap);
if (
  Object.getPrototypeOf(restoredProto) !== Object.prototype ||
  !Object.prototype.hasOwnProperty.call(restoredProto, "__proto__") ||
  (restoredProto as Record<string, unknown>).polluted !== undefined ||
  (Object.prototype as Record<string, unknown>).polluted !== undefined ||
  ((Object.getOwnPropertyDescriptor(restoredProto, "__proto__")?.value as Record<string, unknown>)?.polluted !==
    '张"三\\n\t$& $1') ||
  restoredProto.safe !== '张"三\\n\t$& $1'
) {
  throw new Error(`deanonymize __proto__ 原型保护失败: ${JSON.stringify(restoredProto)}`);
}

console.log("\n🎉 所有 @civic/anonymizer 单元测试全部顺利通过！");
