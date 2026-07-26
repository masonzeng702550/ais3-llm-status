/**
 * Frontmatter-only reader for incident posts.
 *
 * The site renders incidents through Astro content collections (which also
 * validate the schema and fail the build on a malformed post). The probe
 * scripts only ever need the frontmatter, so they use this instead of pulling
 * in the Astro runtime.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parse } from 'yaml';

const INCIDENTS_DIR = fileURLToPath(new URL('../content/incidents', import.meta.url));

export interface IncidentUpdate {
  at: string;
  status: string;
  body: string;
}

export interface IncidentMeta {
  slug: string;
  title: string;
  type: 'incident' | 'maintenance';
  severity: string;
  affected: string[];
  startedAt: string;
  resolvedAt?: string;
  updates: IncidentUpdate[];
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

export function readIncidents(dir = INCIDENTS_DIR): IncidentMeta[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const src = readFileSync(join(dir, file), 'utf8');
      const match = FRONTMATTER.exec(src);
      if (!match) throw new Error(`${file}: missing YAML frontmatter`);

      const fm = parse(match[1] as string) as Record<string, any>;
      for (const key of ['title', 'type', 'severity', 'startedAt']) {
        if (fm[key] === undefined) throw new Error(`${file}: frontmatter is missing "${key}"`);
      }

      return {
        slug: file.replace(/\.md$/, ''),
        title: String(fm.title),
        type: fm.type,
        severity: String(fm.severity),
        affected: Array.isArray(fm.affected) ? fm.affected.map(String) : [],
        startedAt: toIso(fm.startedAt),
        resolvedAt: fm.resolvedAt ? toIso(fm.resolvedAt) : undefined,
        updates: Array.isArray(fm.updates)
          ? fm.updates.map((u: any) => ({
              at: toIso(u.at),
              status: String(u.status),
              body: String(u.body ?? ''),
            }))
          : [],
      } satisfies IncidentMeta;
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** YAML parses unquoted timestamps into Date objects; normalise both forms. */
function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid timestamp: ${String(value)}`);
  return d.toISOString();
}

export function isActive(incident: IncidentMeta, now = new Date()): boolean {
  const started = new Date(incident.startedAt).getTime();
  if (started > now.getTime()) return false;
  if (!incident.resolvedAt) return true;
  return new Date(incident.resolvedAt).getTime() > now.getTime();
}

/** Components currently inside a declared maintenance window. */
export function componentsUnderMaintenance(incidents: IncidentMeta[], now = new Date()): Set<string> {
  const ids = new Set<string>();
  for (const i of incidents) {
    if (i.type !== 'maintenance' || !isActive(i, now)) continue;
    for (const id of i.affected) ids.add(id);
  }
  return ids;
}
