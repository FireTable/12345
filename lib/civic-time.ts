/** 时间筛选相对数据集最新一天，而不是墙钟“今天”，否则历史 Q1 数据会被近 7/30/90 天全部滤空。 */
export function timeWindow(
  time: string,
  ref: Date
): { from?: Date; to?: Date } {
  const startOfRef = new Date(ref);
  startOfRef.setHours(0, 0, 0, 0);
  const endOfRef = new Date(startOfRef);
  endOfRef.setDate(endOfRef.getDate() + 1);

  switch (time) {
    case "今天":
      return { from: startOfRef, to: endOfRef };
    case "昨天": {
      const from = new Date(startOfRef);
      from.setDate(from.getDate() - 1);
      return { from, to: startOfRef };
    }
    case "近7天": {
      const from = new Date(startOfRef);
      from.setDate(from.getDate() - 6);
      return { from, to: endOfRef };
    }
    case "近30天": {
      const from = new Date(startOfRef);
      from.setDate(from.getDate() - 29);
      return { from, to: endOfRef };
    }
    case "近90天": {
      const from = new Date(startOfRef);
      from.setDate(from.getDate() - 89);
      return { from, to: endOfRef };
    }
    case "本月":
      return {
        from: new Date(startOfRef.getFullYear(), startOfRef.getMonth(), 1),
        to: endOfRef,
      };
    case "上月": {
      const from = new Date(startOfRef.getFullYear(), startOfRef.getMonth() - 1, 1);
      const to = new Date(startOfRef.getFullYear(), startOfRef.getMonth(), 1);
      return { from, to };
    }
    default:
      return {};
  }
}

export function normalizeTimeLabel(time: string): string {
  return time.replace(/\s+/g, "");
}

export function inTimeWindow(dateStr: string | undefined | null, time: string, ref: Date): boolean {
  const key = normalizeTimeLabel(time);
  if (!key || key === "全部") return true;
  const win = timeWindow(key, ref);
  if (!win.from && !win.to) return true;
  if (!dateStr) return false;
  const t = Date.parse(String(dateStr).replace(" ", "T"));
  if (Number.isNaN(t)) return false;
  if (win.from && t < win.from.getTime()) return false;
  if (win.to && t >= win.to.getTime()) return false;
  return true;
}
