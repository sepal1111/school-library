// 時間一律以台北時區計算，資料庫存成文字：日期 "YYYY-MM-DD"、時間 "YYYY-MM-DD HH:mm:ss"。
const TZ = "Asia/Taipei";

function parts(d: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
  return out;
}

export function nowText(d = new Date()): string {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

export function todayText(d = new Date()): string {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** 日期字串加上天數（以日曆日計算，不受時區影響）。 */
export function addDays(dateText: string, days: number): string {
  const [y, m, d] = dateText.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** 兩個日期相差的天數（b - a）。 */
export function diffDays(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

export function stamp(d = new Date()): string {
  return nowText(d).replace(/[-: ]/g, "").replace(/^(\d{8})(\d{6})$/, "$1-$2");
}
