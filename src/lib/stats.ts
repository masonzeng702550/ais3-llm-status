import type { DayStat, RawRecord, Status } from './types.ts';

/** Nearest-rank percentile. Returns null for an empty sample. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1] ?? null;
}

function counts(records: RawRecord[]) {
  let up = 0;
  let deg = 0;
  let down = 0;
  for (const r of records) {
    // Maintenance windows are excluded from availability maths entirely:
    // planned downtime is not an outage, and counting it as uptime would be
    // just as dishonest.
    if (r.s === 'maintenance' || r.s === 'unknown') continue;
    if (r.s === 'operational') up++;
    else if (r.s === 'degraded') deg++;
    else down++;
  }
  return { up, deg, down };
}

/**
 * uptime% = (operational + degraded) / measured
 *
 * Degraded counts as available — the service answered. It is surfaced
 * separately in `deg` so a chronically slow component cannot hide behind a
 * green 100%.
 */
export function summarise(records: RawRecord[]): DayStat {
  const { up, deg, down } = counts(records);
  const n = up + deg + down;
  const latencies = records
    .filter((r) => r.ms !== null && r.s !== 'unknown')
    .map((r) => r.ms as number);

  return {
    n,
    up,
    deg,
    down,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    max: latencies.length ? Math.max(...latencies) : null,
  };
}

export function uptimePct(stat: Pick<DayStat, 'n' | 'up' | 'deg'>): number | null {
  if (stat.n === 0) return null;
  return ((stat.up + stat.deg) / stat.n) * 100;
}

/** Combine day stats into one window figure. Days with no samples drop out of the denominator. */
export function uptimeOver(stats: DayStat[]): number | null {
  const measured = stats.filter((s) => s.n > 0);
  if (measured.length === 0) return null;
  const n = measured.reduce((a, s) => a + s.n, 0);
  const ok = measured.reduce((a, s) => a + s.up + s.deg, 0);
  return (ok / n) * 100;
}

export function uptimeFromRecords(records: RawRecord[]): number | null {
  return uptimePct(summarise(records));
}

/** UTC date key, `YYYY-MM-DD`. All storage is UTC; only display is localised. */
export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/** Inclusive list of `YYYY-MM-DD` keys ending at `end`, `days` entries long. */
export function dateRange(end: Date, days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(dateKey(d));
  }
  return out;
}

export const EMPTY_DAY: DayStat = { n: 0, up: 0, deg: 0, down: 0, p50: null, p95: null, max: null };

/** Worst status observed in a day, used to colour-code incident history. */
export function worstStatus(records: RawRecord[]): Status {
  if (records.some((r) => r.s === 'major_outage')) return 'major_outage';
  if (records.some((r) => r.s === 'partial_outage')) return 'partial_outage';
  if (records.some((r) => r.s === 'degraded')) return 'degraded';
  if (records.some((r) => r.s === 'operational')) return 'operational';
  return 'unknown';
}
