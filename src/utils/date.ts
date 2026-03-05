/** 日付ユーティリティ */

/** YYYY-MM-DD 文字列を返す */
export function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Date オブジェクトを YYYY-MM-DD に変換 */
export function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 土日を除く営業日か */
export function isBusinessDay(dateStr: string): boolean {
  const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay(); // 0=Sun, 6=Sat
  return dow !== 0 && dow !== 6;
}

/** dateStr から N 営業日後の日付文字列を返す */
export function addBusinessDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  let remaining = Math.abs(n);
  const dir = n >= 0 ? 1 : -1;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + dir);
    if (isBusinessDay(toDateStr(d))) remaining--;
  }
  return toDateStr(d);
}

/** N 日前の日付文字列 */
export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toDateStr(d);
}

/** date1 < date2 */
export function dateBefore(d1: string, d2: string): boolean {
  return d1 < d2;
}
