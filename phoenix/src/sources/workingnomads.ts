import type { RawJob } from '../types.js';
import { htmlToText, shortHash, toIso } from '../text.js';
import { arr, detectAts, str, type Source } from './common.js';
import { fetchJson } from './http.js';

export interface WorkingNomadsJob {
  url: string;
  title: string;
  description?: string;
  company_name?: string;
  category_name?: string;
  tags?: string | string[];
  location?: string;
  pub_date?: string;
}

export function parseWorkingNomads(payload: unknown): RawJob[] {
  const jobs = (Array.isArray(payload) ? (payload as WorkingNomadsJob[]) : []).filter((j) => j && j.url && j.title);
  return jobs.map((j) => ({
    source: 'workingnomads',
    externalId: shortHash(j.url),
    title: j.title.trim(),
    company: str(j.company_name).trim(),
    url: j.url,
    description: htmlToText(j.description),
    location: j.location || undefined,
    remote: true,
    tags: [...arr(j.tags), str(j.category_name)].filter(Boolean),
    postedAt: toIso(j.pub_date),
    ats: detectAts(j.url),
  }));
}

export const workingnomads: Source = {
  name: 'workingnomads',
  async fetch() {
    const data = await fetchJson('https://www.workingnomads.com/api/exposed_jobs/');
    return parseWorkingNomads(data);
  },
};
