/**
 * 新主题编号接在现有最大序号后面，不从 THEME-1 重排。
 */
import { nextThemeSerial, themeSerial } from "../backend/theme-serial";

function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${message}`);
  }
}

assert(themeSerial("THEME-9125") === 9125, "读出主题序号");
assert(themeSerial("THEME-0") === null, "0 不是有效序号");
assert(themeSerial("其他") === null, "不合格式的 id 忽略");
assert(nextThemeSerial([]) === 1, "没有主题时从 1 开始");
assert(nextThemeSerial(["THEME-1", "THEME-9"]) === 10, "接着当前最大序号");
assert(nextThemeSerial(["THEME-9125", "THEME-0", "备注"]) === 9126, "已有 9125 时下一个是 9126");

if (process.exitCode) process.exit(process.exitCode);
