import type { RawJob } from '../types.js';
import { htmlToText, shortHash, toIso } from '../text.js';
import { arr, detectAts, str, type Source } from './common.js';
import { fetchJson } from './http.js';

export interface HimalayasJob {
  guid?: string;
  title: string;
  excerpt?: string;
  companyName?: string;
  employmentType?: string;
  minSalary?: number;
  maxSalary?: number;
  currency?: string;
  seniority?: string[];
  locationRestrictions?: string[];
  timezoneRestrictions?: string[];
  categories?: string[];
  description?: string;
  pubDate?: number | string;
  applicationLink?: string;
}

export function parseHimalayas(payload: unknown): RawJob[] {
  const jobs = ((payload as { jobs?: HimalayasJob[] })?.jobs ?? []).filter((j) => j && j.title);
  return jobs.map((j) => {
    const url = j.applicationLink || j.guid || '';
    const locations = arr(j.locationRestrictions);
    return {
      source: 'himalayas',
      externalId: j.guid ? shortHash(j.guid) : shortHash(`${j.companyName}|${j.title}|${url}`),
      title: j.title.trim(),
      company: str(j.companyName).trim(),
      url,
      applyUrl: j.applicationLink || undefined,
      description: htmlToText(j.description || j.excerpt),
      location: locations.length ? locations.join(', ') : 'Worldwide',
      remote: true,
      employmentType: j.employmentType || undefined,
      salary: j.minSalary || j.maxSalary ? { min: j.minSalary || undefined, max: j.maxSalary || undefined, currency: j.currency || undefined, period: 'year' as const } : undefined,
      tags: [...arr(j.categories), ...arr(j.seniority), ...arr(j.timezoneRestrictions)],
      postedAt: toIso(j.pubDate),
      ats: detectAts(url),
    };
  });
}

export const himalayas: Source = {
  name: 'himalayas',
  async fetch(ctx) {
    const out: RawJob[] = [];
    const limit = 100;
    for (let offset = 0; offset < 500; offset += limit) {
      const data = await fetchJson<{ jobs?: HimalayasJob[] }>(`https://himalayas.app/jobs/api?limit=${limit}&offset=${offset}`);
      const page = parseHimalayas(data);
      out.push(...page);
      if (page.length < limit) break;
      ctx.log(`himalayas: ${out.length} so far`);
    }
    return out;
  },
};
