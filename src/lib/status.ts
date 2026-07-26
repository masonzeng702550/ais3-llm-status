/**
 * Pure status vocabulary and aggregation rules.
 * No Node built-ins here — this module is also inlined into the browser bundle.
 */
import type { Status } from './types.ts';

export const STATUS_LABEL: Record<Status, string> = {
  operational: '正常運作',
  degraded: '效能降級',
  partial_outage: '部分中斷',
  major_outage: '中斷',
  maintenance: '維護中',
  unknown: '無資料',
};

/** Headline used in the banner at the top of the page. */
export const OVERALL_LABEL: Record<Status, string> = {
  operational: '所有系統正常運作',
  degraded: '部分系統效能降級',
  partial_outage: '部分系統中斷',
  major_outage: '重大服務中斷',
  maintenance: '系統維護中',
  unknown: '目前無法取得服務狀態',
};

/**
 * Every status carries a glyph as well as a colour — colour alone is not an
 * accessible way to communicate state.
 */
export const STATUS_GLYPH: Record<Status, string> = {
  operational: '✓',
  degraded: '!',
  partial_outage: '!',
  major_outage: '✕',
  maintenance: '⚙',
  unknown: '?',
};

export function isOutage(s: Status): boolean {
  return s === 'major_outage' || s === 'partial_outage';
}

/**
 * Roll a set of child statuses up into one.
 *
 * `unknown` children are excluded rather than treated as healthy — a component
 * we failed to measure must never make the group look better than it is, and
 * must never make it look worse either.
 */
export function aggregate(statuses: Status[]): Status {
  const known = statuses.filter((s) => s !== 'unknown');
  if (known.length === 0) return 'unknown';

  const outages = known.filter(isOutage);
  if (outages.length === known.length) return 'major_outage';
  if (outages.length > 0) return 'partial_outage';
  if (known.includes('degraded')) return 'degraded';
  if (known.includes('maintenance')) return 'maintenance';
  return 'operational';
}

/** Bucket a daily uptime percentage into the colour band used by the 90-day bar. */
export function uptimeBand(pct: number | null): 'none' | 'good' | 'warn' | 'bad' | 'critical' {
  if (pct === null) return 'none';
  if (pct >= 99.5) return 'good';
  if (pct >= 95) return 'warn';
  if (pct >= 90) return 'bad';
  return 'critical';
}

export function formatUptime(pct: number | null): string {
  if (pct === null) return '—';
  // Avoid showing a reassuring "100%" for something that is merely 99.996%.
  if (pct < 100 && pct > 99.99) return '99.99%';
  return `${pct.toFixed(pct >= 99.95 ? 0 : 2)}%`;
}

export function formatLatency(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
