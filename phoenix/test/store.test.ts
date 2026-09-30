import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dedupeKey, Store } from '../src/store.js';
import type { RawJob } from '../src/types.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function raw(over: Partial<RawJob>): RawJob {
  return { source: 's', externalId: '1', title: 'Head of AI', company: 'Acme', url: 'https://a', description: 'd', remote: true, tags: [], ats: 'other', ...over };
}

describe('Store', () => {
  it('adds, refreshes and dedupes across sources', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phoenix-'));
    dirs.push(dir);
    const store = new Store(dir);
    const first = store.upsertJobs([raw({}), raw({ source: 't', externalId: '9', company: 'ACME', title: 'Head of AI ' })], '2026-09-01T00:00:00Z');
    expect(first.added).toHaveLength(1);
    expect(first.duplicates).toBe(1);
    const again = store.upsertJobs([raw({ description: 'updated' })], '2026-09-02T00:00:00Z');
    expect(again.added).toHaveLength(0);
    expect(again.updated).toBe(1);
    const jobs = store.loadJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: 's:1', description: 'updated', firstSeenAt: '2026-09-01T00:00:00Z', lastSeenAt: '2026-09-02T00:00:00Z', status: 'new' });
  });

  it('writes packets as JSON and Markdown', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phoenix-'));
    dirs.push(dir);
    const store = new Store(dir);
    const path = store.savePacket({ jobId: 's:1', company: 'Acme', title: 'Head of AI', subject: 'Application', coverLetter: 'Dear team', whyMe: ['a', 'b'], answers: { 'Why?': 'Because.' }, generatedAt: 'now', model: 'm' });
    expect(path.endsWith('s_1.json')).toBe(true);
    expect(store.loadPacket('s:1')?.coverLetter).toBe('Dear team');
  });

  it('builds a key that ignores case and punctuation', () => {
    expect(dedupeKey({ company: 'Acme, Inc.', title: 'Head of AI' })).toBe(dedupeKey({ company: 'acme inc', title: 'HEAD OF AI' }));
  });
});
