/** daily_reports テーブルの操作 */
import { getDb } from './client';

export interface ReportRow {
  date: string;
  content: string;
  created_at: string;
}

export function upsertReport(date: string, content: string): void {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO daily_reports (date, content, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET content=excluded.content, created_at=excluded.created_at
  `).run(date, content, now);
}

export function getReport(date: string): ReportRow | null {
  return (
    getDb()
      .prepare<[string], ReportRow>('SELECT * FROM daily_reports WHERE date=?')
      .get(date) ?? null
  );
}

export function listReports(limit = 30): ReportRow[] {
  return getDb()
    .prepare<[number], ReportRow>('SELECT * FROM daily_reports ORDER BY date DESC LIMIT ?')
    .all(limit);
}
