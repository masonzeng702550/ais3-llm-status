import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { componentIds } from './lib/config.ts';

const ids = componentIds();

const INCIDENT_STATUS = ['investigating', 'identified', 'monitoring', 'resolved'] as const;
const MAINTENANCE_STATUS = ['scheduled', 'in_progress', 'completed'] as const;

const incidents = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/incidents' }),
  schema: z
    .object({
      title: z.string().min(1),
      type: z.enum(['incident', 'maintenance']).default('incident'),
      severity: z.enum(['minor', 'major', 'critical', 'maintenance']),
      // Every id must exist in monitors.yml — a typo here would silently
      // detach the post from the component it is about, so fail the build.
      affected: z
        .array(z.string())
        .default([])
        .refine((list) => list.every((id) => ids.has(id)), {
          message: `unknown component id (known: ${[...ids].join(', ')})`,
        }),
      startedAt: z.coerce.date(),
      resolvedAt: z.coerce.date().optional(),
      updates: z
        .array(
          z.object({
            at: z.coerce.date(),
            status: z.enum([...INCIDENT_STATUS, ...MAINTENANCE_STATUS]),
            body: z.string(),
          }),
        )
        .default([]),
    })
    .refine((d) => !d.resolvedAt || d.resolvedAt >= d.startedAt, {
      message: 'resolvedAt must not be earlier than startedAt',
    }),
});

export const collections = { incidents };
