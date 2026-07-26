/**
 * Build-time data access for the site.
 *
 * The deploy workflow checks the `data` branch out into `.data/`, so the page
 * ships with a real snapshot baked in. When that directory is missing (local
 * dev, or the very first deploy) we render an honest "no data yet" state
 * rather than inventing a green board.
 */
import { loadConfig } from './config.ts';
import { DataStore } from './store.ts';
import { EMPTY_DAY, dateRange } from './stats.ts';
import { aggregate } from './status.ts';
import type { StatusSnapshot, Summary } from './types.ts';

const DATA_DIR = process.env.DATA_DIR ?? '.data/data';

const store = new DataStore(DATA_DIR);
const config = loadConfig();

export const site = config.site;

export const RAW_BASE = `https://raw.githubusercontent.com/${site.owner}/${site.repo}/${site.dataBranch}/data`;

export const SITE_URL = `https://${site.owner}.github.io/${site.repo}/`;

export const REPO_URL = `https://github.com/${site.owner}/${site.repo}`;

function placeholderSnapshot(): StatusSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: new Date(0).toISOString(),
    overall: 'unknown',
    groups: config.groups.map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description,
      status: 'unknown',
      components: group.components.map((c) => ({
        id: c.id,
        name: c.name,
        model: c.model,
        context: c.context,
        status: 'unknown' as const,
        latencyMs: null,
        ttftMs: null,
        error: null,
        lastCheck: null,
        since: null,
        uptime: { '24h': null, '7d': null, '30d': null, '90d': null },
        latency: { p50: null, p95: null },
      })),
    })),
    activeIncidents: [],
  };
}

function placeholderSummary(): Summary {
  const dates = dateRange(new Date(), 90);
  return {
    schemaVersion: 1,
    generatedAt: new Date(0).toISOString(),
    dates,
    components: Object.fromEntries(
      config.groups.flatMap((g) => g.components).map((c) => [c.id, dates.map(() => EMPTY_DAY)]),
    ),
  };
}

export function loadSnapshot(): StatusSnapshot {
  const snapshot = store.readSnapshot();
  if (!snapshot) return placeholderSnapshot();

  // Statuses are recomputed here rather than trusted verbatim so a snapshot
  // written by an older probe version still renders consistent group rollups.
  return {
    ...snapshot,
    groups: snapshot.groups.map((g) => ({
      ...g,
      status: aggregate(g.components.map((c) => c.status)),
    })),
  };
}

export function loadSummary(): Summary {
  return store.readSummary() ?? placeholderSummary();
}

export function hasData(): boolean {
  return store.readSnapshot() !== null;
}
