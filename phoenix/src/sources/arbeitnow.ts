import type { RawJob } from '../types.js';
import { htmlToText, toIso } from '../text.js';
import { arr, detectAts, str, type Source } from './common.js';
import { fetchJson } from './http.js';

export interface ArbeitnowJob {
  slug: string;
  company_name?: string;
  title: string;
  description?: string;
  remote?: boolean;
  url: string;
  tags?: string[];
  job_types?: string[];
  location?: string;
  created_at?: number | string;
}

export function parseArbeitnow(payload: unknown): RawJob[] {
  const jobs = ((payload as { data?: ArbeitnowJob[] })?.data ?? []).filter((j) => j && j.slug && j.title);
  return jobs.map((j) => ({
    source: 'arbeitnow',
    externalId: j.slug,
    title: j.title.trim(),
    company: str(j.company_name).trim(),
    url: j.url,
    description: htmlToText(j.description),
    location: j.location || undefined,
    remote: j.remote === true ? true : j.remote === false ? false : null,
    employmentType: arr(j.job_types)[0],
    tags: arr(j.tags),
    postedAt: toIso(j.created_at),
    ats: detectAts(j.url),
  }));
}

export const arbeitnow: Source = {
  name: 'arbeitnow',
  async fetch() {
    const out: RawJob[] = [];
    for (let page = 1; page <= 4; page++) {
      const data = await fetchJson(`https://www.arbeitnow.com/api/job-board-api?page=${page}`);
      const items = parseArbeitnow(data);
      out.push(...items.filter((j) => j.remote !== false));
      if (items.length === 0) break;
    }
    return out;
  },
};
