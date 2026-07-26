/**
 * Keeps the rendered page in step with the data branch.
 *
 * The page is already correct when it arrives — this only refreshes it. If a
 * fetch fails we say so and leave the last known-good values on screen; a
 * status page that blanks out or silently shows stale green is worse than one
 * that admits it lost contact.
 */
import { OVERALL_LABEL, STATUS_GLYPH, STATUS_LABEL, formatLatency, formatUptime, uptimeBand } from '../lib/status.ts';
import { uptimePct } from '../lib/stats.ts';
import { formatDateTime, relativeTime } from '../lib/format.ts';
import type { DayStat, Status, StatusSnapshot, Summary } from '../lib/types.ts';

const RAW = document.body.dataset.raw ?? '';
const REFRESH_MS = 60_000;
const STALE_MS = 15 * 60_000;

const ERROR_REASON: Record<string, string> = {
  http_429: '請求被限流',
  http_401: '探測憑證遭拒',
  http_403: '探測憑證遭拒',
  timeout: '逾時',
  sse_stall: '串流中斷',
  bad_response: '回應異常',
  network: '連線失敗',
  http_5xx: '伺服器錯誤',
  http_4xx: '請求遭拒',
};

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel);

/**
 * raw.githubusercontent caches for five minutes. A per-minute cache key means
 * the CDN can still serve repeat visitors within the same minute, but we never
 * show data more than a minute staler than the branch.
 */
const bust = (file: string) => `${RAW}/${file}?v=${Math.floor(Date.now() / 60_000)}`;

async function fetchJson<T>(file: string): Promise<T> {
  const res = await fetch(bust(file), { cache: 'no-store' });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

function setNotice(id: string, show: boolean): void {
  const el = document.getElementById(id);
  if (el) el.hidden = !show;
}

function applySnapshot(snapshot: StatusSnapshot): void {
  const banner = $<HTMLElement>('#banner');
  if (banner) {
    banner.className = `banner banner-${snapshot.overall}`;
    const glyph = document.getElementById('banner-glyph');
    const title = document.getElementById('banner-title');
    if (glyph) glyph.textContent = STATUS_GLYPH[snapshot.overall];
    if (title) title.textContent = OVERALL_LABEL[snapshot.overall];
  }

  const rel = document.getElementById('banner-rel');
  const abs = document.getElementById('banner-abs') as HTMLTimeElement | null;
  if (rel) rel.textContent = `更新於 ${relativeTime(snapshot.generatedAt)}`;
  if (abs) {
    abs.dateTime = snapshot.generatedAt;
    abs.textContent = formatDateTime(snapshot.generatedAt);
  }

  setNotice('stale-notice', Date.now() - new Date(snapshot.generatedAt).getTime() > STALE_MS);

  for (const group of snapshot.groups) {
    for (const component of group.components) {
      const wrap = document.querySelector<HTMLElement>(`[data-status="${component.id}"]`);
      if (wrap) wrap.className = `component-status s-${component.status}`;

      const text = document.querySelector<HTMLElement>(`[data-status-text="${component.id}"]`);
      if (text) {
        const reason = component.error ? ERROR_REASON[component.error] : null;
        text.textContent = STATUS_LABEL[component.status] + (reason ? `（${reason}）` : '');
      }

      const latency = document.querySelector<HTMLElement>(`[data-latency="${component.id}"]`);
      if (latency) {
        latency.textContent = component.latencyMs !== null ? formatLatency(component.latencyMs) : '';
      }

      const uptime90 = document.querySelector<HTMLElement>(`[data-uptime90="${component.id}"]`);
      if (uptime90) uptime90.textContent = `${formatUptime(component.uptime['90d'])} 可用率`;
    }
  }
}

function applySummary(summary: Summary): void {
  for (const [id, days] of Object.entries(summary.components)) {
    const bar = document.querySelector<HTMLElement>(`[data-uptime="${id}"]`);
    if (!bar) continue;

    const cells = bar.querySelectorAll<HTMLElement>('.day');
    summary.dates.forEach((date, i) => {
      const cell = cells[i];
      if (!cell) return;
      const stat: DayStat | undefined = days[i];
      const pct = stat ? uptimePct(stat) : null;

      cell.className = `day day-${uptimeBand(pct)}${i < 45 ? ' day-old' : ''}`;
      cell.dataset.date = date;
      cell.dataset.tip = tipFor(date, stat, pct);
    });
  }
}

function tipFor(date: string, stat: DayStat | undefined, pct: number | null): string {
  const [y, m, d] = date.split('-');
  const day = `${y}/${m}/${d}`;
  if (!stat || stat.n === 0) return `${day}｜無探測資料`;
  return (
    `${day}｜可用率 ${formatUptime(pct)}｜${stat.n} 次探測` +
    (stat.down ? `｜失敗 ${stat.down}` : '') +
    (stat.deg ? `｜降級 ${stat.deg}` : '') +
    (stat.p95 !== null ? `｜p95 ${stat.p95}ms` : '')
  );
}

async function refresh(): Promise<void> {
  try {
    const [snapshot, summary] = await Promise.all([
      fetchJson<StatusSnapshot>('status.json'),
      fetchJson<Summary>('summary.json'),
    ]);
    applySnapshot(snapshot);
    applySummary(summary);
    setNotice('fetch-notice', false);
  } catch {
    // Keep whatever is on screen; just stop claiming it is current.
    setNotice('fetch-notice', true);
  }
}

// ---- tooltip ----------------------------------------------------------------

const tip = document.getElementById('tip');

function showTip(target: HTMLElement): void {
  if (!tip) return;
  const text = target.dataset.tip;
  if (!text) return;

  tip.textContent = text;
  tip.setAttribute('data-show', '');

  const rect = target.getBoundingClientRect();
  const width = tip.offsetWidth;
  const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, 8), window.innerWidth - width - 8);
  const above = rect.top - tip.offsetHeight - 8;

  tip.style.left = `${left}px`;
  tip.style.top = `${above < 8 ? rect.bottom + 8 : above}px`;
}

function hideTip(): void {
  tip?.removeAttribute('data-show');
}

document.addEventListener('pointerover', (event) => {
  const target = (event.target as HTMLElement)?.closest<HTMLElement>('.day[data-tip]');
  if (target) showTip(target);
  else hideTip();
});
document.addEventListener('pointerleave', hideTip);
window.addEventListener('scroll', hideTip, { passive: true });

// ---- polling ----------------------------------------------------------------

let timer: number | undefined;

function start(): void {
  stop();
  timer = window.setInterval(refresh, REFRESH_MS);
}

function stop(): void {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
}

// No point polling a page nobody is looking at — but catch up the moment it
// comes back into view.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stop();
  } else {
    void refresh();
    start();
  }
});

void refresh();
start();
