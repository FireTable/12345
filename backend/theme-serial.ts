const THEME_ID = /^THEME-(\d+)$/;

/** 主题编号里的序号。THEME-0 和不合格式的 id 不算。 */
export function themeSerial(id: string): number | null {
  const match = THEME_ID.exec((id || "").trim());
  if (!match) return null;
  const serial = Number(match[1]);
  if (!Number.isSafeInteger(serial) || serial <= 0) return null;
  return serial;
}

/** 下一批新主题从现有最大序号的下一个开始。没有主题时从 1 开始。 */
export function nextThemeSerial(ids: Iterable<string>): number {
  let max = 0;
  for (const id of ids) {
    const serial = themeSerial(id);
    if (serial != null && serial > max) max = serial;
  }
  return max + 1;
}
