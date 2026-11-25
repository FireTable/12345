import { getAllRegions, sql } from "@/db/client";
import { ensureAgentGovernanceTables, generateAgentReport } from "@/lib/agent-governance";
import { filterRegionsByAppDomain, getAppDomainMode } from "@/lib/domain-profile";

export const DAILY_REPORT_TARGET_HOUR_SHANGHAI = resolveTargetHour();
export const DAILY_REPORT_TARGET_MINUTE_SHANGHAI = 0;

declare global {
  // eslint-disable-next-line no-var
  var __civic_daily_report_scheduler_started: boolean | undefined;
  // eslint-disable-next-line no-var
  var __civic_daily_report_scheduler_timer: ReturnType<typeof setTimeout> | undefined;
}

function resolveTargetHour(): number {
  const raw = process.env.DAILY_REPORT_HOUR_SHANGHAI;
  if (!raw) return 18;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23) return 18;
  return parsed;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export interface ShanghaiDateClock {
  dateStr: string;
  hour: number;
  minute: number;
  second: number;
}

export function getShanghaiDateAndClock(now = new Date()): ShanghaiDateClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  const rawHour = Number.parseInt(pick("hour"), 10);
  const hour = Number.isFinite(rawHour) ? rawHour % 24 : 0;
  const minute = Number.parseInt(pick("minute"), 10) || 0;
  const second = Number.parseInt(pick("second"), 10) || 0;

  return {
    dateStr: `${year}-${month}-${day}`,
    hour,
    minute,
    second,
  };
}

export function getShanghaiSlotIso(
  dateStr: string,
  hour = DAILY_REPORT_TARGET_HOUR_SHANGHAI,
  minute = DAILY_REPORT_TARGET_MINUTE_SHANGHAI
): string {
  return `${dateStr}T${pad2(hour)}:${pad2(minute)}:00+08:00`;
}

export function isAtOrAfterShanghaiSlot(
  now = new Date(),
  targetHour = DAILY_REPORT_TARGET_HOUR_SHANGHAI,
  targetMinute = DAILY_REPORT_TARGET_MINUTE_SHANGHAI
): boolean {
  const clock = getShanghaiDateAndClock(now);
  const slotMs = Date.parse(getShanghaiSlotIso(clock.dateStr, targetHour, targetMinute));
  return now.getTime() >= slotMs;
}

export function computeNextShanghaiTriggerMs(
  now = new Date(),
  targetHour = DAILY_REPORT_TARGET_HOUR_SHANGHAI,
  targetMinute = DAILY_REPORT_TARGET_MINUTE_SHANGHAI
): number {
  const clock = getShanghaiDateAndClock(now);
  let targetMs = Date.parse(getShanghaiSlotIso(clock.dateStr, targetHour, targetMinute));
  if (now.getTime() >= targetMs) {
    // Advance to the next calendar day in +08:00 and recompute its HH:MM:00+08:00 slot.
    const nextDayRef = new Date(targetMs + 24 * 60 * 60 * 1000);
    const nextClock = getShanghaiDateAndClock(nextDayRef);
    targetMs = Date.parse(getShanghaiSlotIso(nextClock.dateStr, targetHour, targetMinute));
  }
  return Math.max(1000, targetMs - now.getTime());
}

/**
 * 为当前 APP_DOMAIN 下尚未生成当日定时专报的站点补齐每日研判专报（幂等）。
 * 仅在到达或超过当日 18:00 (+08:00) 后按「同日 slotIso 之后尚无报告」判定触发。
 */
export async function runScheduledDailyReportsForDomain(now = new Date()): Promise<{
  triggered: string[];
  skipped: string[];
  failed: Array<{ regionId: string; error: string }>;
}> {
  const targetHour = DAILY_REPORT_TARGET_HOUR_SHANGHAI;
  const targetMinute = DAILY_REPORT_TARGET_MINUTE_SHANGHAI;
  const { dateStr } = getShanghaiDateAndClock(now);
  const slotIso = getShanghaiSlotIso(dateStr, targetHour, targetMinute);

  const regions = filterRegionsByAppDomain(await getAllRegions(), getAppDomainMode());
  const triggered: string[] = [];
  const skipped: string[] = [];
  const failed: Array<{ regionId: string; error: string }> = [];

  for (const region of regions) {
    try {
      const schemaName = await ensureAgentGovernanceTables(region.id);
      const existing = await sql.unsafe(
        `
        SELECT 1
        FROM "${schemaName}".agent_reports
        WHERE report_date = $1
          AND created_at >= $2::timestamptz
        LIMIT 1
        `,
        [dateStr, slotIso]
      );
      if (existing.length > 0) {
        skipped.push(region.id);
        continue;
      }

      await generateAgentReport(region.id);
      triggered.push(region.id);
      console.log(
        `[daily-report-scheduler] generated ${pad2(targetHour)}:${pad2(targetMinute)} daily report for ${region.id} (${dateStr})`
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ regionId: region.id, error: message });
      console.warn(
        `[daily-report-scheduler] failed for ${region.id} (${dateStr}):`,
        message
      );
    }
  }

  return { triggered, skipped, failed };
}

function scheduleNextDailyReportTick(): number {
  const delayMs = computeNextShanghaiTriggerMs(
    new Date(),
    DAILY_REPORT_TARGET_HOUR_SHANGHAI,
    DAILY_REPORT_TARGET_MINUTE_SHANGHAI
  );

  if (globalThis.__civic_daily_report_scheduler_timer) {
    clearTimeout(globalThis.__civic_daily_report_scheduler_timer);
  }

  const timer = setTimeout(() => {
    void (async () => {
      try {
        await runScheduledDailyReportsForDomain();
      } catch (err: unknown) {
        console.warn("[daily-report-scheduler] tick error:", err instanceof Error ? err.message : err);
      } finally {
        scheduleNextDailyReportTick();
      }
    })();
  }, delayMs);

  timer.unref?.();
  globalThis.__civic_daily_report_scheduler_timer = timer;
  return delayMs;
}

/**
 * 启动进程内每日 18:00 (Asia/Shanghai) 自动研判专报调度器（幂等，单实例仅启动一次）。
 */
export function startDailyReportScheduler(): void {
  if (process.env.CIVIC_DISABLE_DAILY_REPORT_SCHEDULER === "1") return;
  if (globalThis.__civic_daily_report_scheduler_started) return;
  globalThis.__civic_daily_report_scheduler_started = true;

  const now = new Date();
  if (
    isAtOrAfterShanghaiSlot(
      now,
      DAILY_REPORT_TARGET_HOUR_SHANGHAI,
      DAILY_REPORT_TARGET_MINUTE_SHANGHAI
    )
  ) {
    void runScheduledDailyReportsForDomain(now).catch((err: unknown) => {
      console.warn(
        "[daily-report-scheduler] startup catch-up failed:",
        err instanceof Error ? err.message : err
      );
    });
  }

  const nextDelayMs = scheduleNextDailyReportTick();
  console.log(
    `[daily-report-scheduler] started (daily ${pad2(DAILY_REPORT_TARGET_HOUR_SHANGHAI)}:${pad2(DAILY_REPORT_TARGET_MINUTE_SHANGHAI)} Asia/Shanghai, next tick in ${Math.round(nextDelayMs / 60000)}m)`
  );
}
