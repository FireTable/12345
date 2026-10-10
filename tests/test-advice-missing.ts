import { themeNeedsAdvice } from "../backend/node/advice-backfill";

function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${message}`);
  }
}

assert(themeNeedsAdvice(null), "空建议需要补");
assert(themeNeedsAdvice("  "), "空白建议需要补");
assert(!themeNeedsAdvice("牵头部门：街道办"), "已有建议不重写");

if (process.exitCode) process.exit(process.exitCode);
