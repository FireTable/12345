import { desensitizeContent, ticketBodyForAI } from "../backend/anonymizer";
import { buildBatchExtractionPrompt, buildCopilotPrompt } from "../backend/prompt";
import type { RawTicket } from "../backend/state";

type Case = { name: string; ok: boolean; detail?: string };

const cases: Case[] = [];

function assert(name: string, ok: boolean, detail?: string) {
  cases.push({ name, ok, detail });
}

const original =
  "市民陈小明先生（13825789123，身份证440606199208151234）致电反映其朋友（康莉娜）于粤E SD221违停在北滘镇碧桂园西苑翠堤岸10号招财宝民宿3栋502房门口，负责人：苏学良，联系邮箱zhangsan@139.com，固话0757-22334455。";

const masked = desensitizeContent(original);

assert("原文不被函数改写", original.includes("13825789123") && original.includes("陈小明先生"));
assert("手机打码", masked.includes("138****9123") && !masked.includes("13825789123"));
assert("身份证打码", masked.includes("440606********1234") && !masked.includes("440606199208151234"));
assert("固话打码", masked.includes("0757****455") && !masked.includes("0757-22334455"));
assert("邮箱打码", masked.includes("z***@139.com") && !masked.includes("zhangsan@139.com"));
assert("称谓姓名打码且保留称谓", masked.includes("陈*先生") && !masked.includes("陈小明"));
assert("李女士打码", desensitizeContent("李女士来电").includes("李*女士"));
assert(
  "不误伤市民服务热线",
  desensitizeContent("向佛山市市民服务热线投诉").includes("佛山市市民服务热线")
);
assert("括号姓名打码", masked.includes("其朋友（*）") && !masked.includes("康莉娜"));
assert("负责人打码", masked.includes("负责人：*") && !masked.includes("苏学良"));
assert("车牌保留", masked.includes("粤E SD221"));
assert("店名保留", masked.includes("招财宝民宿"));
assert("路名门牌保留", masked.includes("北滘镇碧桂园西苑翠堤岸10号"));
assert("房号保留", masked.includes("3栋502房"));
assert("二次打码幂等", desensitizeContent(masked) === masked);

const stored = ticketBodyForAI({ content: original, maskedContent: "已存脱敏" });
assert("优先使用落库脱敏列", stored === "已存脱敏");
assert("缺省列现场打码", ticketBodyForAI({ content: original }).includes("138****9123"));

const ticket: RawTicket = {
  id: "tk-1",
  ticketNo: "GD-1",
  title: "陈小明先生投诉 13825789123",
  createTime: "2025-01-01 00:00:00",
  citizenName: "陈小明",
  citizenPhone: "13825789123",
  district: "顺德区",
  subdistrict: "北滘镇",
  content: original,
  maskedContent: masked,
  channel: "市民服务热线",
  status: "PENDING",
};

const prompt = buildBatchExtractionPrompt([ticket]);
assert("抽取 Prompt 不含明文手机", !prompt.includes("13825789123"));
assert("抽取 Prompt 不含明文身份证", !prompt.includes("440606199208151234"));
assert("抽取 Prompt 含脱敏正文", prompt.includes("138****9123"));
assert("抽取 Prompt 仍含车牌供聚类", prompt.includes("粤E SD221"));

const staffView = { content: ticket.content, citizenName: ticket.citizenName, citizenPhone: ticket.citizenPhone };
assert("工作人员视图仍是原文", staffView.content.includes("13825789123") && staffView.citizenName === "陈小明");

const copilot = buildCopilotPrompt({
  query: `请分析工单，市民电话13825789123`,
  totalCount: 1,
  currentThemes: [],
  highRiskCount: 0,
  mediumRiskCount: 0,
});
assert("Copilot 问句打码", !copilot.includes("13825789123") && copilot.includes("138****9123"));

const failed = cases.filter((c) => !c.ok);
for (const c of cases) {
  console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
}

console.log("\n--- masked sample ---");
console.log(masked);

if (failed.length > 0) {
  console.error(`\n${failed.length}/${cases.length} failed`);
  process.exit(1);
}

console.log(`\n${cases.length}/${cases.length} passed`);
