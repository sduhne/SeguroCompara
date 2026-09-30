import { describe, expect, it } from 'vitest';
import { parseArbeitnow } from '../src/sources/arbeitnow.js';
import { parseAshby } from '../src/sources/ashby.js';
import { detectAts, inferRemote } from '../src/sources/common.js';
import { parseGreenhouse } from '../src/sources/greenhouse.js';
import { parseHimalayas } from '../src/sources/himalayas.js';
import { parseHnThread } from '../src/sources/hn.js';
import { ALL_SOURCES } from '../src/sources/index.js';
import { parseJobicy } from '../src/sources/jobicy.js';
import { parseLever } from '../src/sources/lever.js';
import { parseRemoteOk } from '../src/sources/remoteok.js';
import { parseRemotive } from '../src/sources/remotive.js';
import { parseWwrRss } from '../src/sources/weworkremotely.js';
import { parseWorkingNomads } from '../src/sources/workingnomads.js';

describe('registry', () => {
  it('exposes eleven sources', () => {
    expect(Object.keys(ALL_SOURCES).sort()).toEqual(['arbeitnow', 'ashby', 'greenhouse', 'himalayas', 'hn', 'jobicy', 'lever', 'remoteok', 'remotive', 'weworkremotely', 'workingnomads']);
  });
});

describe('common helpers', () => {
  it('detects the ATS from the apply URL', () => {
    expect(detectAts('https://boards.greenhouse.io/acme/jobs/1')).toBe('greenhouse');
    expect(detectAts('https://jobs.lever.co/acme/1/apply')).toBe('lever');
    expect(detectAts('https://jobs.ashbyhq.com/acme/1')).toBe('ashby');
    expect(detectAts('mailto:jobs@acme.com')).toBe('email');
    expect(detectAts('https://acme.com/careers')).toBe('other');
  });
  it('infers remote from location text', () => {
    expect(inferRemote('Remote - EMEA')).toBe(true);
    expect(inferRemote('New York (hybrid)')).toBe(false);
    expect(inferRemote('Remote not available', 'Berlin')).toBe(false);
    expect(inferRemote('Berlin')).toBeNull();
  });
});

describe('parsers', () => {
  it('remotive', () => {
    const jobs = parseRemotive({ jobs: [{ id: 7, url: 'https://remotive.com/remote-jobs/finance/x-7', title: 'Finance Director', company_name: 'Acme', category: 'Finance', job_type: 'full_time', publication_date: '2026-09-20T10:00:00', candidate_required_location: 'Worldwide', salary: '$150k', description: '<p>Lead <b>FP&amp;A</b></p>' }] });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ source: 'remotive', externalId: '7', company: 'Acme', location: 'Worldwide', remote: true, employmentType: 'full_time', description: 'Lead FP&A' });
    expect(jobs[0].salary).toMatchObject({ min: 150000, currency: 'USD' });
  });

  it('remoteok skips the legal notice and reads salaries', () => {
    const jobs = parseRemoteOk([{ legal: 'notice' }, { id: 9, slug: 'acme-9', company: 'Acme', position: 'Head of AI', tags: ['ai'], description: '<p>hi</p>', location: 'Worldwide', salary_min: 120000, salary_max: 180000, url: 'https://remoteok.com/remote-jobs/acme-9', apply_url: 'https://jobs.lever.co/acme/9/apply', epoch: 1758000000 }]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ externalId: '9', title: 'Head of AI', ats: 'lever', salary: { min: 120000, max: 180000, currency: 'USD' } });
    expect(jobs[0].postedAt).toBe('2025-09-16T05:20:00.000Z');
  });

  it('jobicy', () => {
    const jobs = parseJobicy({ jobs: [{ id: 3, url: 'https://jobicy.com/jobs/3', jobTitle: 'Fractional CFO', companyName: 'Beta', jobIndustry: ['Finance'], jobType: ['part-time'], jobGeo: 'Anywhere', jobLevel: 'Senior', jobDescription: '<p>x</p>', pubDate: '2026-09-21 08:00:00', annualSalaryMin: '90000', annualSalaryMax: '120000', salaryCurrency: 'EUR' }] });
    expect(jobs[0]).toMatchObject({ title: 'Fractional CFO', employmentType: 'part-time', location: 'Anywhere', salary: { min: 90000, max: 120000, currency: 'EUR' } });
    expect(jobs[0].tags).toEqual(['Finance', 'Senior']);
  });

  it('himalayas', () => {
    const jobs = parseHimalayas({ jobs: [{ guid: 'g1', title: 'VP Finance', companyName: 'Gamma', employmentType: 'Full Time', minSalary: 150000, maxSalary: 180000, currency: 'USD', seniority: ['Director'], locationRestrictions: ['United States', 'Mexico'], categories: ['Finance'], description: '<p>y</p>', pubDate: 1758000000, applicationLink: 'https://boards.greenhouse.io/gamma/jobs/5' }] });
    expect(jobs[0]).toMatchObject({ company: 'Gamma', location: 'United States, Mexico', ats: 'greenhouse', salary: { min: 150000, currency: 'USD' } });
    expect(jobs[0].tags).toContain('Director');
  });

  it('arbeitnow', () => {
    const jobs = parseArbeitnow({ data: [{ slug: 'x-1', company_name: 'Delta', title: 'Strategy Consultant', description: '<p>z</p>', remote: true, url: 'https://www.arbeitnow.com/jobs/x-1', tags: ['consulting'], job_types: ['contract'], location: 'Berlin', created_at: 1758000000 }] });
    expect(jobs[0]).toMatchObject({ externalId: 'x-1', remote: true, employmentType: 'contract', location: 'Berlin' });
  });

  it('working nomads', () => {
    const jobs = parseWorkingNomads([{ url: 'https://www.workingnomads.com/jobs/abc', title: 'Portfolio Manager', description: 'd', company_name: 'Eps', category_name: 'Finance', tags: 'finance,investing', location: 'USA', pub_date: '2026-09-22T00:00:00Z' }]);
    expect(jobs[0]).toMatchObject({ company: 'Eps', remote: true });
    expect(jobs[0].tags).toEqual(['finance', 'investing', 'Finance']);
  });

  it('we work remotely RSS', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>WWR</title>
      <item><title>Zeta Labs: Head of AI Strategy</title><region>Anywhere in the World</region><category>Management and Finance</category><type>Full-Time</type>
      <description><![CDATA[<p>Lead AI strategy.</p><p>To apply: https://weworkremotely.com/remote-jobs/zeta-1</p>]]></description>
      <pubDate>Mon, 22 Sep 2026 10:00:00 +0000</pubDate><link>https://weworkremotely.com/remote-jobs/zeta-1</link><guid isPermaLink="false">wwr-1</guid></item>
      </channel></rss>`;
    const jobs = parseWwrRss(xml);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ company: 'Zeta Labs', title: 'Head of AI Strategy', location: 'Anywhere in the World', employmentType: 'Full-Time', url: 'https://weworkremotely.com/remote-jobs/zeta-1' });
    expect(jobs[0].description).toContain('Lead AI strategy.');
    expect(jobs[0].postedAt).toBe('2026-09-22T10:00:00.000Z');
  });

  it('hacker news thread keeps only remote posts and extracts emails', () => {
    const jobs = parseHnThread({
      id: 1,
      children: [
        { id: 11, author: 'a', text: 'Acme AI | Head of AI Consulting | REMOTE (Americas) | $150k-$180k<p>We help banks adopt LLMs. Email <a href="mailto:hire@acme.ai">hire@acme.ai</a>', created_at: '2026-09-02T00:00:00Z' },
        { id: 12, author: 'b', text: 'Beta | Barista | Onsite NYC', created_at: '2026-09-02T00:00:00Z' },
        { id: 13, author: 'c', text: null, created_at: '2026-09-02T00:00:00Z' },
      ],
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ company: 'Acme AI', title: 'Head of AI Consulting', applyEmail: 'hire@acme.ai', ats: 'email', url: 'https://news.ycombinator.com/item?id=11' });
  });

  it('greenhouse unescapes content and infers remote', () => {
    const jobs = parseGreenhouse({ jobs: [{ id: 42, title: 'Finance Director', updated_at: '2026-09-20T00:00:00Z', location: { name: 'Remote - Americas' }, absolute_url: 'https://boards.greenhouse.io/acme/jobs/42', content: '&lt;p&gt;Own &amp;amp; run FP&amp;amp;A&lt;/p&gt;', departments: [{ name: 'Finance' }] }] }, 'acme', 'Acme Inc');
    expect(jobs[0]).toMatchObject({ externalId: 'acme:42', company: 'Acme Inc', remote: true, ats: 'greenhouse', description: 'Own & run FP&A' });
    expect(jobs[0].tags).toEqual(['Finance']);
  });

  it('lever reads workplace type and salary range', () => {
    const jobs = parseLever([{ id: 'l1', text: 'Strategy Lead', categories: { commitment: 'Full-time', location: 'Remote', team: 'Strategy' }, descriptionPlain: 'Do strategy.', lists: [{ text: 'Requirements', content: '<li>Consulting</li>' }], hostedUrl: 'https://jobs.lever.co/acme/l1', applyUrl: 'https://jobs.lever.co/acme/l1/apply', createdAt: 1758000000000, workplaceType: 'remote', salaryRange: { min: 150000, max: 190000, currency: 'USD', interval: 'per-year-salary' } }], 'acme');
    expect(jobs[0]).toMatchObject({ company: 'Acme', remote: true, employmentType: 'Full-time', salary: { min: 150000, max: 190000, currency: 'USD', period: 'year' } });
    expect(jobs[0].description).toContain('• Consulting');
  });

  it('ashby skips unlisted jobs and parses compensation text', () => {
    const jobs = parseAshby({ jobs: [
      { id: 'a1', title: 'Head of AI Solutions', location: 'Remote', isRemote: true, isListed: true, descriptionPlain: 'Solutions.', jobUrl: 'https://jobs.ashbyhq.com/acme/a1', applyUrl: 'https://jobs.ashbyhq.com/acme/a1/application', employmentType: 'FullTime', publishedAt: '2026-09-20T00:00:00Z', compensation: { compensationTierSummary: '$180K – $220K • Offers Equity' } },
      { id: 'a2', title: 'Hidden', isListed: false },
    ] }, 'acme');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ remote: true, ats: 'ashby', salary: { min: 180000, max: 220000, currency: 'USD' } });
  });
});
