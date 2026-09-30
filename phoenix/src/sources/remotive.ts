import type { RawJob } from '../types.js';
import { htmlToText, parseSalary, toIso } from '../text.js';
import { arr, detectAts, str, type Source } from './common.js';
import { fetchJson } from './http.js';

export interface RemotiveJob {
  id: number | string;
  url: string;
  title: string;
  company_name?: string;
  category?: string;
  tags?: string[];
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
}

export function parseRemotive(payload: unknown): RawJob[] {
  const jobs = ((payload as { jobs?: RemotiveJob[] })?.jobs ?? []).filter((j) => j && j.id !== undefined && j.title);
  return jobs.map((j) => ({
    source: 'remotive',
    externalId: str(j.id),
    title: j.title.trim(),
    company: str(j.company_name).trim(),
    url: j.url,
    description: htmlToText(j.description),
    location: j.candidate_required_location || undefined,
    remote: true,
    employmentType: j.job_type || undefined,
    salary: parseSalary(j.salary),
    tags: [...arr(j.tags), str(j.category)].filter(Boolean),
    postedAt: toIso(j.publication_date),
    ats: detectAts(j.url),
  }));
}

export const remotive: Source = {
  name: 'remotive',
  async fetch(ctx) {
    const out: RawJob[] = [];
    for (const q of ctx.queries) {
      const data = await fetchJson(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=100`);
      out.push(...parseRemotive(data));
    }
    return out;
  },
};
