import type { RawJob } from '../types.js';
import { htmlToText, toIso } from '../text.js';
import { arr, detectAts, str, type Source } from './common.js';
import { fetchJson } from './http.js';

export interface JobicyJob {
  id: number | string;
  url: string;
  jobTitle: string;
  companyName?: string;
  jobIndustry?: string[] | string;
  jobType?: string[] | string;
  jobGeo?: string;
  jobLevel?: string;
  jobExcerpt?: string;
  jobDescription?: string;
  pubDate?: string;
  annualSalaryMin?: number | string;
  annualSalaryMax?: number | string;
  salaryCurrency?: string;
}

export function parseJobicy(payload: unknown): RawJob[] {
  const jobs = ((payload as { jobs?: JobicyJob[] })?.jobs ?? []).filter((j) => j && j.id !== undefined && j.jobTitle);
  return jobs.map((j) => {
    const min = Number(j.annualSalaryMin) || undefined;
    const max = Number(j.annualSalaryMax) || undefined;
    return {
      source: 'jobicy',
      externalId: str(j.id),
      title: j.jobTitle.trim(),
      company: str(j.companyName).trim(),
      url: j.url,
      description: htmlToText(j.jobDescription || j.jobExcerpt),
      location: j.jobGeo || undefined,
      remote: true,
      employmentType: arr(j.jobType)[0],
      salary: min || max ? { min, max, currency: j.salaryCurrency || undefined, period: 'year' as const } : undefined,
      tags: [...arr(j.jobIndustry), str(j.jobLevel)].filter(Boolean),
      postedAt: toIso(j.pubDate),
      ats: detectAts(j.url),
    };
  });
}

export const jobicy: Source = {
  name: 'jobicy',
  async fetch(ctx) {
    const out: RawJob[] = [];
    for (const q of ctx.queries) {
      const data = await fetchJson(`https://jobicy.com/api/v2/remote-jobs?count=50&tag=${encodeURIComponent(q)}`);
      out.push(...parseJobicy(data));
    }
    return out;
  },
};
