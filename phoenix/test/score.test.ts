import { describe, expect, it } from 'vitest';
import { loadConfig, packageRoot } from '../src/config.js';
import { applyScores, scoreJob } from '../src/score.js';
import type { Job } from '../src/types.js';

const { profile } = loadConfig({ root: packageRoot() });
const search = profile.search;
const now = new Date('2026-09-30T12:00:00Z');

function job(over: Partial<Job>): Job {
  return {
    id: 'x:1',
    source: 'x',
    externalId: '1',
    title: 'Role',
    company: 'Co',
    url: 'https://example.com',
    description: '',
    remote: true,
    tags: [],
    ats: 'other',
    firstSeenAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    status: 'new',
    ...over,
  };
}

describe('scoreJob', () => {
  it('shortlists a remote, senior AI strategy role paid in USD', () => {
    const r = scoreJob(
      job({
        title: 'Director of AI Strategy',
        description: 'Own our AI strategy, business case and ROI for generative AI; financial modeling and consulting background; Python. Worldwide.',
        location: 'Remote - Worldwide',
        salary: { min: 160000, max: 200000, currency: 'USD', period: 'year' },
        postedAt: '2026-09-28T00:00:00Z',
      }),
      search,
      now,
    );
    expect(r.rejected).toBeUndefined();
    expect(r.score).toBeGreaterThanOrEqual(search.min_score);
    expect(r.breakdown.title).toBe(35);
    expect(r.breakdown.currency).toBe(10);
  });

  it('rejects junior roles', () => {
    expect(scoreJob(job({ title: 'Junior Financial Analyst' }), search, now).rejected).toBe('junior role');
  });

  it('rejects roles that are not remote', () => {
    expect(scoreJob(job({ title: 'Head of Finance', remote: false }), search, now).rejected).toBe('not remote');
  });

  it('rejects engineering titles unless a target pattern also matches', () => {
    expect(scoreJob(job({ title: 'Senior Software Engineer, Backend' }), search, now).rejected).toMatch(/software engineer/);
    expect(scoreJob(job({ title: 'AI Solutions Engineer' }), search, now).rejected).toBeUndefined();
  });

  it('rejects stale postings', () => {
    expect(scoreJob(job({ title: 'Fractional CFO', postedAt: '2026-06-01T00:00:00Z' }), search, now).rejected).toMatch(/older than/);
  });

  it('penalises US-only and fluent-German requirements', () => {
    const us = scoreJob(job({ title: 'Fractional CFO', location: 'Remote - US only' }), search, now);
    expect(us.breakdown.region).toBe(-20);
    const de = scoreJob(job({ title: 'Fractional CFO', description: 'Fluent German required.' }), search, now);
    expect(de.breakdown.language).toBe(-15);
  });

  it('treats EU-only postings as good regions now that the candidate holds an EU passport', () => {
    expect(scoreJob(job({ title: 'Fractional CFO', location: 'Remote - EU only' }), search, now).breakdown.region).toBe(8);
  });

  it('penalises pay stated only in a weak currency', () => {
    const r = scoreJob(job({ title: 'Portfolio Manager', salary: { min: 40000, currency: 'MXN', period: 'month' } }), search, now);
    expect(r.breakdown.currency).toBe(-10);
  });
});

describe('applyScores', () => {
  it('moves jobs between new, shortlisted and rejected but never touches applied ones', () => {
    const jobs = [
      job({ id: 'a', title: 'Director of AI Strategy', description: 'AI strategy, business case, ROI, financial modeling, consulting, Python, worldwide, USD', location: 'Remote - Worldwide', postedAt: '2026-09-28T00:00:00Z' }),
      job({ id: 'b', title: 'Junior Analyst' }),
      job({ id: 'c', title: 'Junior Analyst', status: 'applied' }),
      job({ id: 'd', title: 'Operations Coordinator', description: 'Scheduling and travel.', postedAt: '2026-09-28T00:00:00Z' }),
    ];
    const r = applyScores(jobs, search, now);
    expect(jobs[0].status).toBe('shortlisted');
    expect(jobs[1].status).toBe('rejected');
    expect(jobs[2].status).toBe('applied');
    expect(jobs[3].status).toBe('new');
    expect(r.shortlisted).toBe(1);
  });
});
