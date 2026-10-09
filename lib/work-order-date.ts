/**
 * 工单编号：250101000770102-01。
 * 前六位是年月日。接着六位是当天递增的受理序号，末三位是反复出现的事项代码，横杠后是重办序号。
 * 这三段都不是时分秒。000770 若当成 00:07:70，秒数不合法；正文里的 00:43:44 也不在这串数字里。
 * 登记时间记亚洲/上海当天 00:00。编号解析不了时返回 null，调用方再去看正文。
 */
export function workOrderInstantFromTicketNo(ticketNo: string | null | undefined): Date | null {
  const digits = String(ticketNo ?? "").trim().match(/^(\d{2})(\d{2})(\d{2})/);
  if (!digits) return null;
  const year = 2000 + Number(digits[1]);
  const month = Number(digits[2]);
  const day = Number(digits[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  const iso = `${year}-${pad(month)}-${pad(day)}T00:00:00+08:00`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  if (shanghaiCalendarDate(date) !== `${year}-${pad(month)}-${pad(day)}`) return null;
  return date;
}

/** 给聚类时间轴用的「YYYY-MM-DD HH:mm:ss」，钟点固定是上海时区零点。 */
export function workOrderClockFromTicketNo(ticketNo: string | null | undefined): string | null {
  const instant = workOrderInstantFromTicketNo(ticketNo);
  if (!instant) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const clock = `${read("year")}-${read("month")}-${read("day")} ${read("hour")}:${read("minute")}:${read("second")}`;
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(clock) ? clock : null;
}

const shanghaiDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function shanghaiCalendarDate(date: Date): string {
  return shanghaiDateFormat.format(date);
}

/** 列表和总览上的日历日。编号零点的 UTC 瞬间会落在前一天，不能直接切 ISO 字符串。 */
export function calendarDay(value: Date | string | null | undefined): string {
  if (value == null || value === "") return "";
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : shanghaiCalendarDate(value);
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}(?:\s|$)/.test(text) && !/[Tt]|Z|[+-]\d{2}:?\d{2}$/.test(text)) {
    return text.slice(0, 10);
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text.slice(0, 10) : shanghaiCalendarDate(date);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
