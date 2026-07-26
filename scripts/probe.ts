/**
 * One probe round: hit every component, fold the results into the data
 * directory, and alert on status changes.
 *
 * Usage: tsx scripts/probe.ts [--data <dir>] [--dry]
 */
import { allComponents, loadConfig } from '../src/lib/config.ts';
import { componentsUnderMaintenance, isActive, readIncidents } from '../src/lib/incidents-meta.ts';
import { probeComponent, redact, type Attempt } from '../src/lib/probe-client.ts';
import { renderBadge } from '../src/lib/badge.ts';
import { sendAlerts, type Transition } from '../src/lib/notify.ts';
import { DataStore, resolveDataDir } from '../src/lib/store.ts';
import {
  EMPTY_DAY,
  bucketRange,
  bucketStart,
  dateKey,
  dateRange,
  percentile,
  summarise,
  uptimeFromRecords,
  uptimeOver,
} from '../src/lib/stats.ts';
import { aggregate } from '../src/lib/status.ts';
import type {
  Buckets,
  ComponentConfig,
  ComponentStatus,
  DayStat,
  ErrorKind,
  GroupStatus,
  ProbeState,
  RawRecord,
  Status,
  StatusSnapshot,
  Summary,
} from '../src/lib/types.ts';

const SUMMARY_DAYS = 90;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run tasks with a bounded pool so we never hammer the backend all at once. */
async function pooled<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * A failed first attempt is retried once. Succeeding only on the retry is
 * reported as degraded rather than operational — it did not work the first
 * time, and pretending otherwise hides real flakiness.
 */
async function probeWithRetry(
  component: ComponentConfig,
  api: { baseUrl: string; userAgent: string },
  apiKey: string,
): Promise<{ attempt: Attempt; attemptNo: number; firstError: ErrorKind | null }> {
  const first = await probeComponent(component, api, apiKey);
  if (first.ok) return { attempt: first, attemptNo: 1, firstError: null };

  // An auth failure will fail identically on retry; don't waste the wait.
  if (first.error === 'http_401' || first.error === 'http_403') {
    return { attempt: first, attemptNo: 1, firstError: first.error };
  }

  let last = first;
  for (let n = 1; n <= component.retries; n++) {
    // Being throttled needs a much longer cool-off than a transient error;
    // retrying after 5s just earns another 429.
    await sleep(last.error === 'http_429' ? component.rateLimitRetryDelayMs : component.retryDelayMs);
    last = await probeComponent(component, api, apiKey);
    // A successful retry still reports why the first attempt failed —
    // otherwise the component goes yellow with no stated reason and the cause
    // is unrecoverable after the fact.
    if (last.ok) return { attempt: last, attemptNo: n + 1, firstError: first.error };
  }
  return { attempt: last, attemptNo: component.retries + 1, firstError: first.error };
}

function toStatus(
  component: ComponentConfig,
  attempt: Attempt,
  attemptNo: number,
  underMaintenance: boolean,
): Status {
  if (underMaintenance) return 'maintenance';

  // Our own credentials being rejected says nothing about the service. Report
  // it as unmeasured rather than claiming an outage we have no evidence for.
  if (attempt.error === 'http_401' || attempt.error === 'http_403') return 'unknown';

  // Throttling means the service is up but refusing work. That is a real
  // problem for callers, but it is not an outage — and calling it one would
  // light the board up red every time we probe slightly too fast.
  if (attempt.error === 'http_429') return 'degraded';

  if (!attempt.ok) return 'major_outage';
  if (attemptNo > 1) return 'degraded';
  if (attempt.latencyMs !== null && attempt.latencyMs > component.degradedMs) return 'degraded';
  return 'operational';
}

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new DataStore(resolveDataDir());
  const dry = process.argv.includes('--dry');

  const apiKey = process.env[config.api.authEnv];
  if (!apiKey) {
    console.error(`Missing ${config.api.authEnv}. Set it in .env locally or as an Actions secret.`);
    process.exit(1);
  }

  const now = new Date();
  const startedAt = now.toISOString();
  const today = dateKey(now);
  const yesterday = dateKey(new Date(now.getTime() - 86_400_000));

  const incidents = readIncidents();
  const maintaining = componentsUnderMaintenance(incidents, now);
  const components = allComponents(config);

  console.log(`probing ${components.length} components at ${startedAt}`);

  const outcomes = await pooled(components, config.concurrency, async (component, index) => {
    if (maintaining.has(component.id)) {
      return {
        component,
        attempt: null as Attempt | null,
        attemptNo: 0,
        firstError: null as ErrorKind | null,
      };
    }
    // Space probes out: back-to-back requests on one key draw 429s, and they
    // also queue behind each other on the backend, inflating the latency we
    // are trying to measure.
    if (index > 0) await sleep(config.staggerMs);
    try {
      return { component, ...(await probeWithRetry(component, config.api, apiKey)) };
    } catch (err) {
      console.warn(`[probe] ${component.id}: ${redact((err as Error).message)}`);
      return {
        component,
        attempt: { ok: false, latencyMs: null, ttftMs: null, code: null, error: 'network' as const },
        attemptNo: 1,
        firstError: 'network' as ErrorKind,
      };
    }
  });

  const records: RawRecord[] = outcomes.map(({ component, attempt, attemptNo, firstError }) => {
    const status = toStatus(component, attempt ?? blankAttempt(), attemptNo, maintaining.has(component.id));
    return {
      t: startedAt,
      c: component.id,
      s: status,
      ms: attempt?.latencyMs ?? null,
      ttft: attempt?.ttftMs ?? null,
      code: attempt?.code ?? null,
      a: attemptNo,
      e: attempt?.error ?? firstError ?? null,
    };
  });

  for (const r of records) {
    const ttft = r.ttft === null ? '' : ` ttft=${r.ttft}ms`;
    console.log(
      `  ${r.s.padEnd(14)} ${r.c.padEnd(24)} ${r.ms ?? '-'}ms${ttft}${r.e ? ` (${r.e})` : ''}`,
    );
  }

  if (dry) {
    console.log('--dry: nothing written');
    return;
  }

  store.appendRaw(today, records);

  // ---- rebuild summary (today's column only; rollup.ts owns the rest) ----
  const todayRecords = store.readRaw(today);
  const recent = [...store.readRaw(yesterday), ...todayRecords];
  const cutoff = now.getTime() - 86_400_000;
  const last24h = recent.filter((r) => new Date(r.t).getTime() >= cutoff);

  const previous = store.readSummary();
  const dates = dateRange(now, SUMMARY_DAYS);
  const summary: Summary = {
    schemaVersion: 1,
    generatedAt: startedAt,
    dates,
    components: {},
  };

  for (const component of components) {
    const byDate = new Map<string, DayStat>();
    previous?.dates.forEach((d, i) => {
      const stat = previous.components[component.id]?.[i];
      if (stat) byDate.set(d, stat);
    });
    byDate.set(today, summarise(todayRecords.filter((r) => r.c === component.id)));
    summary.components[component.id] = dates.map((d) => byDate.get(d) ?? EMPTY_DAY);
  }
  store.writeSummary(summary);

  // ---- live minute buckets ----
  // The daily bar takes three months to fill in. This is the same idea at a
  // resolution you can actually watch: one cell per minute over the last hour
  // and a half, which fills in while you are looking at it.
  const { barCells, barBucketSeconds } = config.display;
  const keys = bucketRange(now, barBucketSeconds, barCells);
  const windowStart = new Date(keys[0] as string).getTime();
  const buckets: Buckets = {
    schemaVersion: 1,
    generatedAt: startedAt,
    bucketSeconds: barBucketSeconds,
    keys,
    components: {},
  };

  const byComponentBucket = new Map<string, Map<number, RawRecord[]>>();
  for (const record of recent) {
    if (new Date(record.t).getTime() < windowStart) continue;
    const slot = bucketStart(record.t, barBucketSeconds);
    let perComponent = byComponentBucket.get(record.c);
    if (!perComponent) byComponentBucket.set(record.c, (perComponent = new Map()));
    const list = perComponent.get(slot);
    if (list) list.push(record);
    else perComponent.set(slot, [record]);
  }

  for (const component of components) {
    const perComponent = byComponentBucket.get(component.id);
    buckets.components[component.id] = keys.map((key) => {
      const list = perComponent?.get(new Date(key).getTime());
      return list ? summarise(list) : EMPTY_DAY;
    });
  }
  store.writeBuckets(buckets);

  // ---- state machine: `since` timestamps and alert debouncing ----
  const state: ProbeState = store.readState();
  const transitions: Transition[] = [];

  const statusById = new Map(records.map((r) => [r.c, r.s]));

  for (const component of components) {
    const status = statusById.get(component.id) as Status;
    const prev = state.components[component.id];

    if (!prev) {
      state.components[component.id] = {
        status,
        since: startedAt,
        consecutiveFailures: status === 'major_outage' ? 1 : 0,
        alerted: false,
      };
      continue;
    }

    const failures = status === 'major_outage' ? prev.consecutiveFailures + 1 : 0;
    const changed = prev.status !== status;

    // Alert only once a failure has survived `failuresBeforeAlert` rounds, so a
    // single blip does not page anyone. Recovery alerts fire immediately, but
    // only if we actually alerted about the outage.
    let alerted = prev.alerted;
    if (status === 'major_outage' && failures >= config.alerting.failuresBeforeAlert && !prev.alerted) {
      transitions.push({ id: component.id, name: component.name, from: prev.status, to: status });
      alerted = true;
    } else if (status !== 'major_outage' && prev.alerted) {
      transitions.push({ id: component.id, name: component.name, from: prev.status, to: status });
      alerted = false;
    }

    state.components[component.id] = {
      status,
      since: changed ? startedAt : prev.since,
      consecutiveFailures: failures,
      alerted,
    };
  }
  store.writeState(state);

  // ---- snapshot ----
  const groups: GroupStatus[] = config.groups.map((group) => {
    const componentStatuses: ComponentStatus[] = group.components.map((component) => {
      const record = records.find((r) => r.c === component.id) as RawRecord;
      const stats = summary.components[component.id] ?? [];
      const mine = last24h.filter((r) => r.c === component.id);
      const latencies = mine.filter((r) => r.ms !== null).map((r) => r.ms as number);

      return {
        id: component.id,
        name: component.name,
        model: component.model,
        context: component.context,
        status: record.s,
        latencyMs: record.ms,
        ttftMs: record.ttft,
        error: record.e,
        lastCheck: record.t,
        since: state.components[component.id]?.since ?? record.t,
        uptime: {
          '24h': uptimeFromRecords(mine),
          '7d': uptimeOver(stats.slice(-7)),
          '30d': uptimeOver(stats.slice(-30)),
          '90d': uptimeOver(stats),
        },
        latency: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
      };
    });

    return {
      id: group.id,
      name: group.name,
      description: group.description,
      status: aggregate(componentStatuses.map((c) => c.status)),
      components: componentStatuses,
    };
  });

  const snapshot: StatusSnapshot = {
    schemaVersion: 1,
    generatedAt: startedAt,
    overall: aggregate(groups.flatMap((g) => g.components.map((c) => c.status))),
    groups,
    activeIncidents: incidents.filter((i) => isActive(i, now)).map((i) => ({
      slug: i.slug,
      title: i.title,
      type: i.type,
      severity: i.severity,
      status: i.updates.at(-1)?.status ?? 'investigating',
      startedAt: i.startedAt,
    })),
  };
  store.writeSnapshot(snapshot);

  for (const group of groups) {
    for (const component of group.components) {
      store.writeBadge(component.id, renderBadge(component.name, component.status));
    }
  }
  store.writeBadge('overall', renderBadge(config.site.name, snapshot.overall));

  const siteUrl = `https://${config.site.owner}.github.io/${config.site.repo}/`;
  await sendAlerts(transitions, process.env[config.alerting.webhookEnv], siteUrl);

  console.log(`overall: ${snapshot.overall}`);
}

function blankAttempt(): Attempt {
  return { ok: true, latencyMs: null, ttftMs: null, code: null, error: null };
}

main().catch((err) => {
  console.error(redact((err as Error).stack ?? String(err)));
  process.exit(1);
});
