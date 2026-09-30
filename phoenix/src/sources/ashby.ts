import type { RawJob } from '../types.js';
import { htmlToText, parseSalary, toIso } from '../text.js';
import { inferRemote, str, titleCase, type Source } from './common.js';
import { fetchJson, HttpError } from './http.js';

export interface AshbyJob {
  id: string;
  title: string;
  department?: string;
  team?: string;
  employmentType?: string;
  location?: string;
  secondaryLocations?: Array<{ location?: string }>;
  publishedAt?: string;
  isListed?: boolean;
  isRemote?: boolean;
  descriptionHtml?: string;
  descriptionPlain?: string;
  jobUrl?: string;
  applyUrl?: string;
  compensation?: { compensationTierSummary?: string; scrapeableCompensationSalarySummary?: string };
}

export function parseAshby(payload: unknown, company: string): RawJob[] {
  const jobs = ((payload as { jobs?: AshbyJob[] })?.jobs ?? []).filter((j) => j && j.id && j.title && j.isListed !== false);
  return jobs.map((j) => {
    const location = [j.location, ...(j.secondaryLocations ?? []).map((s) => str(s.location))].filter(Boolean).join(', ') || undefined;
    const description = j.descriptionPlain || htmlToText(j.descriptionHtml);
    const compText = j.compensation?.scrapeableCompensationSalarySummary || j.compensation?.compensationTierSummary;
    return {
      source: 'ashby',
      externalId: `${company}:${j.id}`,
      title: j.title.trim(),
      company: titleCase(company),
      url: j.jobUrl ?? `https://jobs.ashbyhq.com/${company}/${j.id}`,
      applyUrl: j.applyUrl ?? `https://jobs.ashbyhq.com/${company}/${j.id}/application`,
      description,
      location,
      remote: j.isRemote === true ? true : inferRemote(location, j.title),
      employmentType: j.employmentType || undefined,
      salary: parseSalary(compText),
      tags: [j.department, j.team].map(str).filter(Boolean),
      postedAt: toIso(j.publishedAt),
      ats: 'ashby' as const,
    };
  });
}

export const ashby: Source = {
  name: 'ashby',
  async fetch(ctx) {
    const out: RawJob[] = [];
    for (const company of ctx.boards.ashby) {
      try {
        const data = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${company}?includeCompensation=true`, { retries: 0 });
        out.push(...parseAshby(data, company));
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) ctx.log(`ashby: no board "${company}"`);
        else throw err;
      }
    }
    return out;
  },
};
