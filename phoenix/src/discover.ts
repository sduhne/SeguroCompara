import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.js';
import { applyScores, scoreJob } from './score.js';
import { ALL_SOURCES, runSources, type SourceRunResult } from './sources/index.js';
import type { SourceContext } from './sources/common.js';
import type { Store } from './store.js';
import type { RawJob } from './types.js';

export interface DiscoverOptions {
  /** Restrict to these sources (default: every source enabled in profile.yaml). */
  sources?: string[];
  /** Read a JSON array of raw jobs instead of the network (tests, demos, offline). */
  fixture?: string;
  log?: (msg: string) => void;
}

export interface DiscoverSummary {
  ranAt: string;
  perSource: SourceRunResult['perSource'];
  fetched: number;
  dropped: number;
  added: number;
  updated: number;
  duplicates: number;
  shortlisted: number;
  total: number;
}

export function enabledSources(config: Config): string[] {
  const entries = Object.entries(config.profile.sources);
  if (entries.length === 0) return Object.keys(ALL_SOURCES);
  return entries.filter(([, on]) => on).map(([name]) => name);
}

function isUsable(job: RawJob): boolean {
  return Boolean(job.title && job.url && (job.company || job.source === 'hn'));
}

export async function discover(config: Config, store: Store, opts: DiscoverOptions = {}): Promise<DiscoverSummary> {
  const log = opts.log ?? (() => {});
  const { profile } = config;
  let fetched: RawJob[];
  let perSource: SourceRunResult['perSource'];

  if (opts.fixture) {
    fetched = JSON.parse(readFileSync(opts.fixture, 'utf8')) as RawJob[];
    perSource = { fixture: { count: fetched.length, ms: 0 } };
  } else {
    const names = opts.sources?.length ? opts.sources : enabledSources(config);
    const ctx: SourceContext = { queries: profile.search.queries, boards: profile.boards, maxAgeDays: profile.search.max_age_days, log };
    log(`discover: running ${names.join(', ')}`);
    const result = await runSources(names, ctx);
    fetched = result.jobs;
    perSource = result.perSource;
    for (const [name, s] of Object.entries(perSource)) log(`  ${name}: ${s.count} jobs in ${s.ms} ms${s.error ? ` (error: ${s.error})` : ''}`);
  }

  const seen = new Set<string>();
  const keep: RawJob[] = [];
  let dropped = 0;
  const now = new Date();
  for (const raw of fetched) {
    if (!isUsable(raw)) {
      dropped++;
      continue;
    }
    const id = raw.id ?? `${raw.source}:${raw.externalId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const r = scoreJob(raw, profile.search, now);
    if (r.rejected || r.score < profile.search.store_floor) {
      dropped++;
      continue;
    }
    keep.push({ ...raw, id });
  }

  const { added, updated, duplicates } = store.upsertJobs(keep, now.toISOString());
  const jobs = store.loadJobs();
  const { shortlisted } = applyScores(jobs, profile.search, now);
  store.saveJobs(jobs);

  const summary: DiscoverSummary = {
    ranAt: now.toISOString(),
    perSource,
    fetched: fetched.length,
    dropped,
    added: added.length,
    updated,
    duplicates,
    shortlisted,
    total: jobs.length,
  };
  writeFileSync(join(store.dir, 'last-run.json'), JSON.stringify(summary, null, 2) + '\n');
  return summary;
}
