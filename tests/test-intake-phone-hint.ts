/**
 * 诉求登记手机号位数异常检测与温和提示回归测试：
 * - 覆盖 `detectMalformedMobileAttempt` 正误报边界（10位/12位/带cue文本/正常11位/订单号/门牌号）
 * - 覆盖 `processIntakeChat` 对 `gz_tianhe` 的三轮对话（缺联系方式 -> 输入10位 `1380023800` -> 补全11位 `13800238000`）
 */

import assert from "node:assert/strict";
import {
  detectMalformedMobileAttempt,
  processIntakeChat,
} from "../lib/agent-governance";

async function main() {
  // 1. 单元测试：detectMalformedMobileAttempt
  assert.deepEqual(
    detectMalformedMobileAttempt("1380023800"),
    { length: 10, isOnlyContactAttempt: true },
    "纯 10 位手机号应识别为纯联系方式错位尝试"
  );

  assert.deepEqual(
    detectMalformedMobileAttempt("手机号 138001380000"),
    { length: 12, isOnlyContactAttempt: true },
    "12 位超长手机号应识别并提示位数过多"
  );

  assert.deepEqual(
    detectMalformedMobileAttempt("我的电话是1380023800，帮我登记"),
    { length: 10, isOnlyContactAttempt: false },
    "带明确电话引导词但非纯联系方式句应返回 isOnlyContactAttempt=false"
  );

  assert.equal(
    detectMalformedMobileAttempt("13800138000"),
    null,
    "标准 11 位手机号不应触发异常提示"
  );

  assert.equal(
    detectMalformedMobileAttempt("订单 1380023800 未发货"),
    null,
    "订单号不应被误判为输错的手机号"
  );

  assert.equal(
    detectMalformedMobileAttempt("天河南路138号烧烤"),
    null,
    "地址门牌号不应被误判为手机号"
  );

  // 2. 端到端多轮测试：processIntakeChat (gz_tianhe 只读站点选项，无持久化副作用)
  const turn1 = await processIntakeChat({
    regionId: "gz_tianhe",
    messages: [{ role: "user", content: "投诉天河南路壹号烧烤夜间油烟过多" }],
  });
  assert.equal(turn1.draft.contactPhone, "", "首轮未提供手机号");
  assert.equal(turn1.readyToSubmit, false, "首轮缺少联系方式不可提交");
  assert.ok(
    turn1.missingFields.includes("联系电话或电子邮箱"),
    "首轮缺失字段包含联系方式"
  );

  const turn2 = await processIntakeChat({
    regionId: "gz_tianhe",
    draft: turn1.draft,
    messages: [
      { role: "user", content: "投诉天河南路壹号烧烤夜间油烟过多" },
      { role: "assistant", content: turn1.reply },
      { role: "user", content: "1380023800" },
    ],
  });
  assert.equal(turn2.draft.contactPhone, "", "10 位号码不应写入 contactPhone");
  assert.equal(turn2.readyToSubmit, false, "10 位号码不可标记 readyToSubmit");
  assert.equal(
    turn2.draft.content.includes("1380023800"),
    false,
    "纯输错的号码不得污染正文 content"
  );
  assert.ok(turn2.reply.includes("10 位"), `回复应明确告知当前为 10 位，实际：${turn2.reply}`);
  assert.ok(turn2.reply.includes("少了 1 位"), `回复应指出少了 1 位，实际：${turn2.reply}`);
  assert.ok(turn2.reply.includes("11 位"), `回复应指出手机号应为 11 位，实际：${turn2.reply}`);

  const turn3 = await processIntakeChat({
    regionId: "gz_tianhe",
    draft: turn2.draft,
    messages: [
      { role: "user", content: "投诉天河南路壹号烧烤夜间油烟过多" },
      { role: "assistant", content: turn1.reply },
      { role: "user", content: "1380023800" },
      { role: "assistant", content: turn2.reply },
      { role: "user", content: "13800238000" },
    ],
  });
  assert.equal(turn3.draft.contactPhone, "13800238000", "补齐 11 位后正确写入 contactPhone");
  assert.equal(turn3.readyToSubmit, true, "要素齐备后 readyToSubmit 应为 true");

  console.log("✅ All intake malformed phone hint tests passed!");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ test-intake-phone-hint failed:", err);
    process.exit(1);
  });
