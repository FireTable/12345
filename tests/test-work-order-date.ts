/**
 * 工单日期以编号前六位为准。正文里的另一个日期不能替换它。
 */
import { buildRecordsFromRows } from "../lib/ticket-ingest";
import { regionLabel } from "../lib/civic-dto";
import { calendarDay, shanghaiCalendarDate, workOrderClockFromTicketNo, workOrderInstantFromTicketNo } from "../lib/work-order-date";

function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${message}`);
  }
}

const ticketNo = "250101000770102-01";
const { records, failedCount } = buildRecordsFromRows(
  [
    {
      ticketNo,
      title: "商业噪音",
      content: "市民于2024年12月31日23:59:39来电，反映商铺夜间扰民。",
    },
  ],
  "DATE-TEST"
);

const createTime = records[0]?.createTime as Date | undefined;
const shanghai = createTime ? shanghaiCalendarDate(createTime) : "";

assert(failedCount === 0 && records.length === 1, "入库路径产出一条记录");
assert(records[0]?.ticketNo === ticketNo, `工单编号保持 ${records[0]?.ticketNo}`);
assert(shanghai === "2025-01-01", `上海日历日是 ${shanghai}`);
assert(createTime?.toISOString() === "2024-12-31T16:00:00.000Z", `零点瞬间是 ${createTime?.toISOString()}`);
assert(workOrderClockFromTicketNo(ticketNo) === "2025-01-01 00:00:00", "不从流水号编造钟点");
assert(workOrderInstantFromTicketNo("250231000000000-01") === null, "2月31日不是日期");
assert(workOrderInstantFromTicketNo("not-a-ticket") === null, "没有年月日的编号不解析");
assert(createTime ? calendarDay(createTime) === "2025-01-01" : false, "列表日期用上海日历日");
assert(regionLabel(null, "顺德区") === "未知", "没有镇街时不显示区名");
assert(regionLabel("伦教街道", "顺德区") === "伦教", "有镇街时显示镇街短名");

if (process.exitCode) {
  console.error("work-order date test failed");
} else {
  console.log(`ticket ${ticketNo} stored ${shanghai} Asia/Shanghai`);
}
