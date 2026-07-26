/** Self-contained shields-style SVG badges, served straight off the data branch. */
import type { Status } from './types.ts';

const COLOR: Record<Status, string> = {
  operational: '#16a34a',
  degraded: '#ca8a04',
  partial_outage: '#ea580c',
  major_outage: '#dc2626',
  maintenance: '#2563eb',
  unknown: '#9ca3af',
};

const TEXT: Record<Status, string> = {
  operational: 'operational',
  degraded: 'degraded',
  partial_outage: 'partial outage',
  major_outage: 'outage',
  maintenance: 'maintenance',
  unknown: 'unknown',
};

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Verdana 11px is roughly 6.4px per character; close enough for badge widths. */
const width = (text: string) => Math.round(text.length * 6.4) + 20;

export function renderBadge(label: string, status: Status): string {
  const value = TEXT[status];
  const lw = width(label);
  const vw = width(value);
  const total = lw + vw;
  const color = COLOR[status];
  const aria = `${label}: ${value}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${escape(aria)}">
  <title>${escape(aria)}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="#555"/>
    <rect x="${lw}" width="${vw}" height="20" fill="${color}"/>
    <rect width="${total}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${escape(label)}</text>
    <text x="${lw / 2}" y="14">${escape(label)}</text>
    <text x="${lw + vw / 2}" y="15" fill="#010101" fill-opacity=".3">${escape(value)}</text>
    <text x="${lw + vw / 2}" y="14">${escape(value)}</text>
  </g>
</svg>
`;
}
