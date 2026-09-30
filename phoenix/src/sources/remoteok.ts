import type { RawJob } from '../types.js';
import { htmlToText, toIso } from '../text.js';
import { arr, detectAts, str, type Source } from './common.js';
import { fetchJson } from './http.js';

export interface RemoteOkJob {
  id?: number | string;
  slug?: string;
  company?: string;
  position?: string;
  tags?: string[];
  description?: string;
  location?: string;
  salary_min?: number;
  salary_max?: number;
  url?: string;
  apply_url?: string;
  date?: string;
  epoch?: number;
  legal?: string;
}

export function parseRemoteOk(payload: unknown): RawJob[] {
  const items = Array.isArray(payload) ? (payload as RemoteOkJob[]) : [];
  return items
    .filter((j) => j && j.position && (j.id !== undefined || j.slug))
    .map((j) => {
      const url = j.url ?? `https://remoteok.com/remote-jobs/${j.slug}`;
      const apply = j.apply_url ?? url;
      const hasSalary = typeof j.salary_min === 'number' && j.salary_min > 0;
      return {
        source: 'remoteok',
        externalId: str(j.id ?? j.slug),
        title: str(j.position).trim(),
        company: str(j.company).trim(),
        url,
        applyUrl: apply,
        description: htmlToText(j.description),
        location: j.location || undefined,
        remote: true,
        salary: hasSalary ? { min: j.salary_min, max: j.salary_max || undefined, currency: 'USD', period: 'year' as const } : undefined,
        tags: arr(j.tags),
        postedAt: toIso(j.epoch ?? j.date),
        ats: detectAts(apply),
      };
    });
}

export const remoteok: Source = {
  name: 'remoteok',
  async fetch() {
    const data = await fetchJson('https://remoteok.com/api');
    return parseRemoteOk(data);
  },
};
