/** Status-change alerts to a Discord or Slack incoming webhook. */
import { STATUS_LABEL } from './status.ts';
import type { Status } from './types.ts';
import { redact } from './probe-client.ts';

export interface Transition {
  id: string;
  name: string;
  from: Status;
  to: Status;
}

function describe(t: Transition): string {
  const arrow = `${STATUS_LABEL[t.from]} → ${STATUS_LABEL[t.to]}`;
  const icon = t.to === 'operational' ? '✅' : t.to === 'degraded' ? '⚠️' : '🔴';
  return `${icon} **${t.name}** ${arrow}`;
}

export async function sendAlerts(
  transitions: Transition[],
  webhookUrl: string | undefined,
  siteUrl: string,
): Promise<void> {
  if (!webhookUrl || transitions.length === 0) return;

  const lines = transitions.map(describe).join('\n');
  const text = `**AIS3 LLM Status**\n${lines}\n<${siteUrl}>`;

  // Slack and Discord disagree on the field name; everything else matches.
  const payload = webhookUrl.includes('hooks.slack.com')
    ? { text: text.replace(/\*\*/g, '*') }
    : { content: text };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`[notify] webhook returned ${res.status}`);
    }
  } catch (err) {
    // Never let a broken webhook fail the probe run — the data matters more.
    console.warn(`[notify] ${redact((err as Error).message)}`);
  }
}
