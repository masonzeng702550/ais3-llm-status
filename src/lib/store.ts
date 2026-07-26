/**
 * Read/write helpers for the data directory that lives on the `data` branch.
 *
 * Layout:
 *   status.json            current snapshot
 *   summary.json           last 90 days, per component, per day
 *   state.json             probe state machine (since / failure counters)
 *   raw/YYYY-MM-DD.jsonl   raw probe records, kept 30 days
 *   daily/YYYY-MM.json     permanent per-day rollups
 *   badges/<id>.svg
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  Buckets,
  MonthlyRollup,
  ProbeState,
  RawRecord,
  StatusSnapshot,
  Summary,
} from './types.ts';

export function resolveDataDir(argv: string[] = process.argv): string {
  const i = argv.indexOf('--data');
  if (i !== -1 && argv[i + 1]) return argv[i + 1] as string;
  return process.env.DATA_DIR ?? '.data/data';
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (err) {
    // A corrupt file must not silently reset history to "everything is fine".
    throw new Error(`Failed to parse ${path}: ${(err as Error).message}`);
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export class DataStore {
  constructor(readonly dir: string) {}

  private p(...parts: string[]): string {
    return join(this.dir, ...parts);
  }

  readState(): ProbeState {
    return readJson<ProbeState>(this.p('state.json'), { components: {} });
  }

  writeState(state: ProbeState): void {
    writeJson(this.p('state.json'), state);
  }

  readSnapshot(): StatusSnapshot | null {
    return readJson<StatusSnapshot | null>(this.p('status.json'), null);
  }

  writeSnapshot(snapshot: StatusSnapshot): void {
    writeJson(this.p('status.json'), snapshot);
  }

  readBuckets(): Buckets | null {
    return readJson<Buckets | null>(this.p('minutes.json'), null);
  }

  writeBuckets(buckets: Buckets): void {
    writeJson(this.p('minutes.json'), buckets);
  }

  readSummary(): Summary | null {
    return readJson<Summary | null>(this.p('summary.json'), null);
  }

  writeSummary(summary: Summary): void {
    writeJson(this.p('summary.json'), summary);
  }

  readRaw(date: string): RawRecord[] {
    const path = this.p('raw', `${date}.jsonl`);
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as RawRecord);
  }

  appendRaw(date: string, records: RawRecord[]): void {
    if (records.length === 0) return;
    const path = this.p('raw', `${date}.jsonl`);
    mkdirSync(dirname(path), { recursive: true });
    const lines = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
    if (existsSync(path)) {
      writeFileSync(path, readFileSync(path, 'utf8') + lines, 'utf8');
    } else {
      writeFileSync(path, lines, 'utf8');
    }
  }

  rawPath(date: string): string {
    return this.p('raw', `${date}.jsonl`);
  }

  /** Every date that currently has a raw file, oldest first. */
  listRawDates(): string[] {
    const dir = this.p('raw');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => f.replace(/\.jsonl$/, ''))
      .sort();
  }

  deleteRaw(date: string): void {
    rmSync(this.rawPath(date), { force: true });
  }

  listMonths(): string[] {
    const dir = this.p('daily');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
  }

  readMonthly(month: string): MonthlyRollup {
    return readJson<MonthlyRollup>(this.p('daily', `${month}.json`), { month, days: {} });
  }

  writeMonthly(rollup: MonthlyRollup): void {
    writeJson(this.p('daily', `${rollup.month}.json`), rollup);
  }

  writeBadge(id: string, svg: string): void {
    const path = this.p('badges', `${id}.svg`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, svg, 'utf8');
  }
}
