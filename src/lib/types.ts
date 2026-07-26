/** Shared types for the probe pipeline and the site. */

export const STATUS_ORDER = [
  'operational',
  'degraded',
  'partial_outage',
  'major_outage',
  'maintenance',
  'unknown',
] as const;

export type Status = (typeof STATUS_ORDER)[number];

export type ProbeType = 'chat' | 'guard' | 'http';

export type ErrorKind =
  | 'timeout'
  | 'http_401'
  | 'http_403'
  | 'http_429'
  | 'http_4xx'
  | 'http_5xx'
  | 'network'
  | 'bad_response'
  | 'sse_stall';

export interface ComponentConfig {
  id: string;
  name: string;
  model?: string;
  context?: string;
  url?: string;
  auth?: boolean;
  probeType: ProbeType;
  degradedMs: number;
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
  stream: boolean;
  prompt: string;
  expectValue: string;
  retries: number;
  retryDelayMs: number;
  rateLimitRetryDelayMs: number;
}

export interface GroupConfig {
  id: string;
  name: string;
  description?: string;
  components: ComponentConfig[];
}

export interface SiteConfig {
  name: string;
  tagline: string;
  timezone: string;
  owner: string;
  repo: string;
  dataBranch: string;
}

export interface MonitorConfig {
  site: SiteConfig;
  api: { baseUrl: string; authEnv: string; userAgent: string };
  groups: GroupConfig[];
  concurrency: number;
  staggerMs: number;
  alerting: { webhookEnv: string; failuresBeforeAlert: number };
  retention: { rawDays: number; summaryDays: number };
}

/**
 * One probe result, as stored in `raw/YYYY-MM-DD.jsonl`.
 * Keys are deliberately short — this file gets ~2,600 lines a day.
 *
 * Never add a field that could carry model output or credentials.
 */
export interface RawRecord {
  /** ISO8601 UTC, probe start. */
  t: string;
  /** component id */
  c: string;
  s: Status;
  /** total latency, ms */
  ms: number | null;
  /** time to first token, ms */
  ttft: number | null;
  /** HTTP status code */
  code: number | null;
  /** which attempt succeeded (or was the last to fail) */
  a: number;
  e: ErrorKind | null;
}

export interface UptimeWindows {
  '24h': number | null;
  '7d': number | null;
  '30d': number | null;
  '90d': number | null;
}

export interface ComponentStatus {
  id: string;
  name: string;
  model?: string;
  context?: string;
  status: Status;
  latencyMs: number | null;
  ttftMs: number | null;
  error: ErrorKind | null;
  lastCheck: string | null;
  /** when the current status began */
  since: string | null;
  uptime: UptimeWindows;
  latency: { p50: number | null; p95: number | null };
}

export interface GroupStatus {
  id: string;
  name: string;
  description?: string;
  status: Status;
  components: ComponentStatus[];
}

export interface ActiveIncidentRef {
  slug: string;
  title: string;
  type: 'incident' | 'maintenance';
  severity: string;
  status: string;
  startedAt: string;
}

export interface StatusSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  overall: Status;
  groups: GroupStatus[];
  activeIncidents: ActiveIncidentRef[];
}

/** Per-component, per-day rollup. */
export interface DayStat {
  /** samples taken */
  n: number;
  up: number;
  deg: number;
  down: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export interface MonthlyRollup {
  month: string;
  /** date (YYYY-MM-DD) -> component id -> stats */
  days: Record<string, Record<string, DayStat>>;
}

export interface Summary {
  schemaVersion: 1;
  generatedAt: string;
  /** oldest to newest, exactly `days` entries */
  dates: string[];
  components: Record<string, DayStat[]>;
}

/** Persisted state machine data, used for `since` and alert debouncing. */
export interface ProbeState {
  components: Record<
    string,
    {
      status: Status;
      since: string;
      consecutiveFailures: number;
      alerted: boolean;
    }
  >;
}
