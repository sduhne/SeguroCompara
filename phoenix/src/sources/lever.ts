import type { RawJob } from '../types.js';
import { htmlToText, toIso } from '../text.js';
import { inferRemote, str, titleCase, type Source } from './common.js';
import { fetchJson, HttpError } from './http.js';

export interface LeverPosting {
  id: string;
  text: string;
  categories?: { commitment?: string; location?: string; team?: string; department?: string; allLocations?: string[] };
  descriptionPlain?: string;
  description?: string;
  lists?: Array<{ text?: string; content?: string }>;
  additionalPlain?: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  workplaceType?: string;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
}

export function parseLever(payload: unknown, company: string): RawJob[] {
  const posts = (Array.isArray(payload) ? (payload as LeverPosting[]) : []).filter((p) => p && p.id && p.text);
  return posts.map((p) => {
    const lists = (p.lists ?? []).map((l) => `${str(l.text)}\n${htmlToText(l.content)}`).join('\n\n');
    const description = [p.descriptionPlain || htmlToText(p.description), lists, p.additionalPlain].filter(Boolean).join('\n\n');
    const location = [p.categories?.location, ...(p.categories?.allLocations ?? [])].filter(Boolean).join(', ') || undefined;
    const wt = str(p.workplaceType).toLowerCase();
    const remote = wt === 'remote' ? true : wt === 'onsite' || wt === 'hybrid' ? false : inferRemote(location, p.text);
    const sr = p.salaryRange;
    const interval = str(sr?.interval).toLowerCase();
    return {
      source: 'lever',
      externalId: `${company}:${p.id}`,
      title: p.text.trim(),
      company: titleCase(company),
      url: p.hostedUrl ?? `https://jobs.lever.co/${company}/${p.id}`,
      applyUrl: p.applyUrl ?? `https://jobs.lever.co/${company}/${p.id}/apply`,
      description,
      location,
      remote,
      employmentType: p.categories?.commitment || undefined,
      salary: sr && (sr.min || sr.max) ? { min: sr.min || undefined, max: sr.max || undefined, currency: sr.currency || undefined, period: interval.includes('hour') ? ('hour' as const) : interval.includes('month') ? ('month' as const) : ('year' as const) } : undefined,
      tags: [p.categories?.team, p.categories?.department].map(str).filter(Boolean),
      postedAt: toIso(p.createdAt),
      ats: 'lever' as const,
    };
  });
}

export const lever: Source = {
  name: 'lever',
  async fetch(ctx) {
    const out: RawJob[] = [];
    for (const company of ctx.boards.lever) {
      try {
        const data = await fetchJson(`https://api.lever.co/v0/postings/${company}?mode=json`, { retries: 0 });
        out.push(...parseLever(data, company));
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) ctx.log(`lever: no board "${company}"`);
        else throw err;
      }
    }
    return out;
  },
};
