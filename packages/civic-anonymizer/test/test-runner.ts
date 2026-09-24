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
if (round2.text.includes("{{PHONE_NUMBER_2}}")) throw new Error("继承后手机号不应变为 2！");

console.log("\n🎉 所有 @civic/anonymizer 单元测试全部顺利通过！");
