import type { RawJob } from '../types.js';
import { htmlToText, toIso } from '../text.js';
import { inferRemote, str, titleCase, type Source } from './common.js';
import { fetchJson, HttpError } from './http.js';

export interface GreenhouseJob {
  id: number | string;
  title: string;
  updated_at?: string;
  first_published?: string;
  location?: { name?: string };
  absolute_url: string;
  content?: string;
  departments?: Array<{ name?: string }>;
  metadata?: Array<{ name?: string; value?: unknown }>;
}

export function parseGreenhouse(payload: unknown, board: string, companyName?: string): RawJob[] {
  const jobs = ((payload as { jobs?: GreenhouseJob[] })?.jobs ?? []).filter((j) => j && j.id !== undefined && j.title);
  const company = companyName || titleCase(board);
  return jobs.map((j) => {
    const location = j.location?.name || undefined;
    const description = htmlToText(j.content);
    return {
      source: 'greenhouse',
      externalId: `${board}:${j.id}`,
      title: j.title.trim(),
      company,
      url: j.absolute_url,
      applyUrl: j.absolute_url,
      description,
      location,
      remote: inferRemote(location, j.title, description.slice(0, 600)),
      tags: (j.departments ?? []).map((d) => str(d.name)).filter(Boolean),
      postedAt: toIso(j.first_published ?? j.updated_at),
      ats: 'greenhouse' as const,
    };
  });
}

export const greenhouse: Source = {
  name: 'greenhouse',
  async fetch(ctx) {
    const out: RawJob[] = [];
    for (const board of ctx.boards.greenhouse) {
      try {
        const meta = await fetchJson<{ name?: string }>(`https://boards-api.greenhouse.io/v1/boards/${board}`, { retries: 0 });
        const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`);
        out.push(...parseGreenhouse(data, board, meta.name));
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) ctx.log(`greenhouse: no board "${board}"`);
        else throw err;
      }
    }
    return out;
  },
};
