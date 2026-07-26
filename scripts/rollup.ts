/**
 * Daily maintenance: fold raw probe records into permanent per-day rollups,
 * rebuild the 90-day summary, and drop raw files past their retention window.
 *
 * Safe to run repeatedly — it is a pure function of what is on disk.
 *
 * Usage: tsx scripts/rollup.ts [--data <dir>]
 */
import { allComponents, loadConfig } from '../src/lib/config.ts';
import { DataStore, resolveDataDir } from '../src/lib/store.ts';
import { EMPTY_DAY, dateKey, dateRange, summarise } from '../src/lib/stats.ts';
import { monthKey } from '../src/lib/stats.ts';
import type { DayStat, MonthlyRollup, Summary } from '../src/lib/types.ts';

const SUMMARY_DAYS = 90;

function main(): void {
  const config = loadConfig();
  const store = new DataStore(resolveDataDir());
  const components = allComponents(config);

  const now = new Date();
  const today = dateKey(now);

  // ---- 1. fold raw files into daily rollups ----
  const rollups = new Map<string, MonthlyRollup>();
  const loadMonth = (month: string): MonthlyRollup => {
    let r = rollups.get(month);
    if (!r) {
      r = store.readMonthly(month);
      rollups.set(month, r);
    }
    return r;
  };

  for (const date of store.listRawDates()) {
    const records = store.readRaw(date);
    if (records.length === 0) continue;

    const rollup = loadMonth(monthKey(date));
    const day: Record<string, DayStat> = {};
    for (const component of components) {
      const mine = records.filter((r) => r.c === component.id);
      if (mine.length > 0) day[component.id] = summarise(mine);
    }
    rollup.days[date] = day;
  }

  for (const rollup of rollups.values()) store.writeMonthly(rollup);

  // ---- 2. rebuild the 90-day summary from the rollups ----
  const dates = dateRange(now, SUMMARY_DAYS);
  const months = new Set(dates.map(monthKey));
  const byDate = new Map<string, Record<string, DayStat>>();
  for (const month of months) {
    const rollup = rollups.get(month) ?? store.readMonthly(month);
    for (const [date, day] of Object.entries(rollup.days)) byDate.set(date, day);
  }

  const summary: Summary = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    dates,
    components: {},
  };
  for (const component of components) {
    summary.components[component.id] = dates.map(
      (d) => byDate.get(d)?.[component.id] ?? EMPTY_DAY,
    );
  }
  store.writeSummary(summary);

  // ---- 3. retention ----
  // Only prune days that made it into a rollup, so a failed fold can never
  // destroy the only copy of a day's data.
  const keepAfter = dateKey(new Date(now.getTime() - config.retention.rawDays * 86_400_000));
  let pruned = 0;
  for (const date of store.listRawDates()) {
    if (date >= keepAfter || date === today) continue;
    const rollup = rollups.get(monthKey(date)) ?? store.readMonthly(monthKey(date));
    if (!rollup.days[date]) {
      console.warn(`[rollup] keeping ${date}: not present in daily rollup`);
      continue;
    }
    store.deleteRaw(date);
    pruned++;
  }

  console.log(
    `rollup: ${rollups.size} month file(s), ${dates.length}-day summary, ${pruned} raw file(s) pruned`,
  );
}

main();
