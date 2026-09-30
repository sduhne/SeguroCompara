import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, packageRoot } from '../src/config.js';
import { discover } from '../src/discover.js';
import { buildReport } from '../src/report.js';
import { Store } from '../src/store.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('discover with a fixture', () => {
  it('stores the good jobs, drops the bad ones, and reports', async () => {
    const root = packageRoot();
    const dir = mkdtempSync(join(tmpdir(), 'phoenix-'));
    dirs.push(dir);
    const config = loadConfig({ root, dataDir: dir });
    const store = new Store(dir);
    const summary = await discover(config, store, { fixture: join(root, 'test', 'fixtures', 'sample-jobs.json') });
    expect(summary.fetched).toBe(6);
    expect(summary.added).toBe(3);
    expect(summary.dropped).toBe(3);
    const jobs = store.loadJobs();
    const titles = jobs.map((j) => j.title).sort();
    expect(titles).toEqual(['Director of AI Strategy', 'Fractional CFO (part-time, remote)', 'Management Consultant, AI Transformation']);
    expect(jobs.every((j) => j.status === 'shortlisted')).toBe(true);
    const report = buildReport(store);
    expect(report).toContain('Best matches not yet applied to');
    expect(report).toContain('Northwind Analytics');
  });
});
