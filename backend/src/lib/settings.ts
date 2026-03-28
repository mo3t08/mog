import db from "../db.js";

export interface Shift {
  start: number; // hour 0-23
  end: number;   // hour 1-24
}

export interface BusinessSettings {
  shifts: Shift[];
  workDays: number[]; // ISO weekday: 1=Mon … 7=Sun
}

let cache: { data: BusinessSettings; ts: number } | null = null;
const TTL = 30_000; // 30s cache

export async function getSettings(): Promise<BusinessSettings> {
  if (cache && Date.now() - cache.ts < TTL) return cache.data;
  const { rows } = await db.query("SELECT key, value FROM settings");
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  const s1s = parseInt(map.shift1_start ?? map.open_hour ?? "9", 10);
  const s1e = parseInt(map.shift1_end ?? "14", 10);
  const s2s = parseInt(map.shift2_start ?? "16", 10);
  const s2e = parseInt(map.shift2_end ?? map.close_hour ?? "20", 10);

  const shifts: Shift[] = [];
  if (s1e > s1s) shifts.push({ start: s1s, end: s1e });
  if (s2e > s2s) shifts.push({ start: s2s, end: s2e });
  if (shifts.length === 0) shifts.push({ start: 9, end: 20 }); // fallback

  const data: BusinessSettings = {
    shifts,
    workDays: (map.work_days ?? "1,2,3,4,5").split(",").map(Number),
  };
  cache = { data, ts: Date.now() };
  return data;
}

/** Returns list of closed date strings (YYYY-MM-DD) for a month */
export async function getClosedDates(year: number, month: number): Promise<string[]> {
  const { rows } = await db.query(
    "SELECT date::text FROM closed_dates WHERE EXTRACT(YEAR FROM date) = $1 AND EXTRACT(MONTH FROM date) = $2",
    [year, month]
  );
  return rows.map((r: { date: string }) => r.date);
}

export function invalidateSettingsCache() {
  cache = null;
}
