import type { RawJob } from '../types.js';
import { arbeitnow } from './arbeitnow.js';
import { ashby } from './ashby.js';
import type { Source, SourceContext } from './common.js';
import { greenhouse } from './greenhouse.js';
import { himalayas } from './himalayas.js';
import { hn } from './hn.js';
import { jobicy } from './jobicy.js';
import { lever } from './lever.js';
import { remoteok } from './remoteok.js';
import { remotive } from './remotive.js';
import { weworkremotely } from './weworkremotely.js';
import { workingnomads } from './workingnomads.js';

export const ALL_SOURCES: Record<string, Source> = Object.fromEntries(
  [remotive, remoteok, jobicy, himalayas, arbeitnow, weworkremotely, workingnomads, hn, greenhouse, lever, ashby].map((s) => [s.name, s]),
);

export interface SourceRunResult {
  jobs: RawJob[];
  perSource: Record<string, { count: number; ms: number; error?: string }>;
}

/** Run the named sources concurrently; one failing source never blocks the others. */
export async function runSources(names: string[], ctx: SourceContext): Promise<SourceRunResult> {
  const jobs: RawJob[] = [];
  const perSource: SourceRunResult['perSource'] = {};
  await Promise.all(
    names.map(async (name) => {
      const source = ALL_SOURCES[name];
      if (!source) {
        perSource[name] = { count: 0, ms: 0, error: 'unknown source' };
        return;
      }
      const started = Date.now();
      try {
        const found = await source.fetch(ctx);
        jobs.push(...found);
        perSource[name] = { count: found.length, ms: Date.now() - started };
      } catch (err) {
        perSource[name] = { count: 0, ms: Date.now() - started, error: (err as Error).message };
      }
    }),
  );
  return { jobs, perSource };
}
