import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { ComponentConfig, GroupConfig, MonitorConfig } from './types.ts';

const CONFIG_PATH = fileURLToPath(new URL('../../config/monitors.yml', import.meta.url));

interface RawDefaults {
  probeType: ComponentConfig['probeType'];
  maxTokens: number;
  temperature: number;
  stream: boolean;
  retries: number;
  retryDelayMs: number;
  prompt: string;
  expectValue: string;
  concurrency: number;
  staggerMs: number;
  rateLimitRetryDelayMs: number;
}

let cached: MonitorConfig | null = null;

export function loadConfig(): MonitorConfig {
  if (cached) return cached;

  const doc = parse(readFileSync(CONFIG_PATH, 'utf8')) as Record<string, any>;
  const defaults = doc.defaults as RawDefaults;

  const groups: GroupConfig[] = (doc.groups ?? []).map((g: any) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    components: (g.components ?? []).map((c: any): ComponentConfig => {
      const probeType = c.probeType ?? defaults.probeType;

      if (probeType === 'http' && !c.url) {
        throw new Error(`monitors.yml: component "${c.id}" is probeType=http but has no url`);
      }
      if (probeType !== 'http' && !c.model) {
        throw new Error(`monitors.yml: component "${c.id}" is probeType=${probeType} but has no model`);
      }

      return {
        id: c.id,
        name: c.name,
        model: c.model,
        context: c.context,
        url: c.url,
        auth: c.auth ?? false,
        probeType,
        degradedMs: c.degradedMs,
        timeoutMs: c.timeoutMs,
        maxTokens: c.maxTokens ?? defaults.maxTokens,
        temperature: c.temperature ?? defaults.temperature,
        stream: c.stream ?? defaults.stream,
        prompt: c.prompt ?? defaults.prompt,
        expectValue: c.expectValue ?? defaults.expectValue,
        retries: c.retries ?? defaults.retries,
        retryDelayMs: c.retryDelayMs ?? defaults.retryDelayMs,
        rateLimitRetryDelayMs: c.rateLimitRetryDelayMs ?? defaults.rateLimitRetryDelayMs,
      };
    }),
  }));

  const ids = groups.flatMap((g) => g.components.map((c) => c.id));
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) {
    throw new Error(`monitors.yml: duplicate component ids: ${[...new Set(dupes)].join(', ')}`);
  }

  cached = {
    site: doc.site,
    api: doc.api,
    groups,
    concurrency: defaults.concurrency ?? 1,
    staggerMs: defaults.staggerMs ?? 1500,
    alerting: doc.alerting,
    retention: doc.retention,
  };
  return cached;
}

export function allComponents(config = loadConfig()): ComponentConfig[] {
  return config.groups.flatMap((g) => g.components);
}

export function componentIds(config = loadConfig()): Set<string> {
  return new Set(allComponents(config).map((c) => c.id));
}
