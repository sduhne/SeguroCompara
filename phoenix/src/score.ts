import type { Search } from './config.js';
import { annualUsd, detectCurrencies, normalizeKey } from './text.js';
import type { Job, JobStatus } from './types.js';

export interface ScoreResult {
  score: number;
  breakdown: Record<string, number>;
  rejected?: string;
}

export type Scorable = Pick<Job, 'title' | 'company' | 'description' | 'location' | 'remote' | 'employmentType' | 'salary' | 'tags' | 'postedAt'>;

const regexCache = new Map<string, RegExp | null>();

function compile(pattern: string): RegExp | null {
  if (!regexCache.has(pattern)) {
    try {
      regexCache.set(pattern, new RegExp(pattern, 'i'));
    } catch {
      console.warn(`profile.yaml: ignoring invalid title pattern ${JSON.stringify(pattern)}`);
      regexCache.set(pattern, null);
    }
  }
  return regexCache.get(pattern) ?? null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phraseRegex(phrase: string): RegExp {
  const key = `phrase:${phrase}`;
  let re = regexCache.get(key);
  if (!re) {
    const body = escapeRegExp(phrase.trim());
    const lead = /^\w/.test(phrase) ? '(?<![\\w])' : '';
    const tail = /\w$/.test(phrase) ? '(?![\\w])' : '';
    re = new RegExp(`${lead}${body}${tail}`, 'i');
    regexCache.set(key, re);
  }
  return re;
}

function has(text: string, phrase: string): boolean {
  return phraseRegex(phrase).test(text);
}

function countHits(text: string, phrases: string[]): number {
  let n = 0;
  for (const p of phrases) if (has(text, p)) n++;
  return n;
}

const LANGUAGE_REQUIREMENT = /\b(fluent|native|professional|business[- ]level|proficient)\s+(in\s+)?(german|french|dutch|portuguese|japanese|mandarin|chinese|korean|italian|arabic|hindi)\b/i;

export function scoreJob(job: Scorable, search: Search, now: Date = new Date()): ScoreResult {
  const b: Record<string, number> = {};
  const title = job.title.trim();
  const description = job.description ?? '';
  const tags = (job.tags ?? []).join(' ');
  const all = `${title}\n${description}\n${tags}`;
  const head = `${title}\n${job.location ?? ''}\n${description.slice(0, 2000)}`;
  const reject = (why: string): ScoreResult => ({ score: 0, breakdown: b, rejected: why });

  if (search.blocked_companies.some((c) => normalizeKey(c) === normalizeKey(job.company))) return reject('blocked company');
  if (search.junior_words.some((w) => has(title, w))) return reject('junior role');
  if (job.remote === false) return reject('not remote');

  let ageDays: number | undefined;
  if (job.postedAt) {
    const t = Date.parse(job.postedAt);
    if (!Number.isNaN(t)) ageDays = (now.getTime() - t) / 86_400_000;
  }
  if (ageDays !== undefined && ageDays > search.max_age_days) return reject(`older than ${search.max_age_days} days`);

  let bestTitle = 0;
  for (const t of search.titles) {
    const re = compile(t.pattern);
    if (re && re.test(title) && t.weight > bestTitle) bestTitle = t.weight;
  }
  b.title = Math.min(35, bestTitle);

  const negativeTitle = search.negative_titles.find((n) => has(title, n));
  if (negativeTitle && bestTitle < 25) return reject(`title matches "${negativeTitle}"`);

  const strong = countHits(all, search.keywords_strong);
  const normal = countHits(all, search.keywords);
  b.keywords = Math.min(25, strong * 3 + normal);

  b.seniority = search.senior_words.some((w) => has(title, w)) ? 8 : 0;

  const region = `${job.location ?? ''}\n${description.slice(0, 1500)}`.toLowerCase();
  if (search.regions_bad.some((r) => has(region, r))) b.region = -20;
  else if (search.regions_good.some((r) => has(region, r))) b.region = 8;
  else b.region = 0;

  const currencies = new Set<string>();
  if (job.salary?.currency) currencies.add(job.salary.currency.toUpperCase());
  for (const c of detectCurrencies(job.salary?.raw ?? '')) currencies.add(c);
  for (const c of detectCurrencies(head)) currencies.add(c);
  if ([...currencies].some((c) => search.currencies_preferred.includes(c))) b.currency = 10;
  else if ([...currencies].some((c) => search.currencies_ok.includes(c))) b.currency = 5;
  else if (currencies.size > 0) b.currency = -10;
  else b.currency = 0;

  const usd = annualUsd(job.salary);
  if (usd !== undefined && search.min_annual_usd !== undefined && usd < search.min_annual_usd) b.pay = -15;
  else if (usd !== undefined && usd >= 120_000) b.pay = 5;
  else b.pay = 0;

  const et = (job.employmentType ?? '').toLowerCase();
  b.engagement = /contract|freelance|part[- _]?time|fractional/.test(et) ? 3 : 0;

  if (ageDays === undefined) b.freshness = 0;
  else if (ageDays <= 7) b.freshness = 5;
  else if (ageDays <= 30) b.freshness = 2;
  else b.freshness = -5;

  const negatives = countHits(all, search.negative_keywords);
  b.negatives = -Math.min(24, negatives * 8);
  b.language = LANGUAGE_REQUIREMENT.test(all) ? -15 : 0;

  const total = Object.values(b).reduce((s, v) => s + v, 0);
  return { score: Math.max(0, Math.min(100, Math.round(total))), breakdown: b };
}

const FROZEN: JobStatus[] = ['applied', 'interview', 'offer', 'closed', 'skipped', 'needs_human'];

/** Re-score every job in place and move new/shortlisted/rejected statuses accordingly. */
export function applyScores(jobs: Job[], search: Search, now: Date = new Date()): { shortlisted: number; rejected: number } {
  let shortlisted = 0;
  let rejected = 0;
  for (const job of jobs) {
    const r = scoreJob(job, search, now);
    job.score = r.score;
    job.scoreBreakdown = r.breakdown;
    job.rejectedReason = r.rejected;
    if (FROZEN.includes(job.status)) continue;
    if (r.rejected) {
      job.status = 'rejected';
      rejected++;
    } else if (r.score >= search.min_score) {
      if (job.status !== 'tailored') job.status = 'shortlisted';
      shortlisted++;
    } else {
      job.status = 'new';
    }
  }
  return { shortlisted, rejected };
}

/** Sort key: Claude's fit when present, else the rule-based score. */
export function rank(job: Job): number {
  return job.llm ? job.llm.fit * 0.6 + (job.score ?? 0) * 0.4 : (job.score ?? 0);
}
