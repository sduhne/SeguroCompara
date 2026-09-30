import type { RawJob } from '../types.js';
import { htmlToText, toIso, truncate } from '../text.js';
import { firstEmail, str, type Source } from './common.js';
import { fetchJson } from './http.js';

export interface HnComment {
  id: number;
  author?: string | null;
  text?: string | null;
  created_at?: string;
  children?: HnComment[];
}

export interface HnItem {
  id: number;
  title?: string;
  children?: HnComment[];
}

/**
 * Turn the top-level comments of a "Who is hiring?" thread into jobs. Posts follow the
 * convention `Company | Role | Location | REMOTE | Salary`, but the parser only relies on the
 * first line for company and title and keeps the whole comment as the description.
 */
export function parseHnThread(item: HnItem): RawJob[] {
  const out: RawJob[] = [];
  for (const c of item.children ?? []) {
    if (!c || !c.text) continue;
    const body = htmlToText(c.text);
    if (!/\bremote\b/i.test(body)) continue;
    const firstLine = body.split('\n').find((l) => l.trim())?.trim() ?? '';
    const parts = firstLine.split('|').map((p) => p.trim()).filter(Boolean);
    const company = parts[0] ? truncate(parts[0], 80) : str(c.author);
    const roleParts = parts.slice(1).filter((p) => !/^(remote|onsite|hybrid|full[- ]time|part[- ]time|contract)\b/i.test(p) && !/\$|€|£|\d{2,3}k/i.test(p));
    const title = roleParts[0] ? truncate(roleParts[0], 120) : truncate(firstLine, 120);
    const email = firstEmail(body);
    const url = `https://news.ycombinator.com/item?id=${c.id}`;
    out.push({
      source: 'hn',
      externalId: String(c.id),
      title,
      company,
      url,
      applyUrl: email ? `mailto:${email}` : undefined,
      description: body,
      location: parts.find((p) => /remote/i.test(p)) ?? 'Remote',
      remote: true,
      tags: ['hn-who-is-hiring'],
      postedAt: toIso(c.created_at),
      ats: email ? 'email' : 'other',
      applyEmail: email,
    });
  }
  return out;
}

interface AlgoliaHit {
  objectID: string;
  title?: string;
  created_at?: string;
}

export async function findLatestHiringThread(): Promise<AlgoliaHit | undefined> {
  const q = encodeURIComponent('"Ask HN: Who is hiring?"');
  const data = await fetchJson<{ hits?: AlgoliaHit[] }>(
    `https://hn.algolia.com/api/v1/search_by_date?query=${q}&tags=story,author_whoishiring&hitsPerPage=10`,
  );
  return (data.hits ?? []).filter((h) => /who is hiring/i.test(h.title ?? '')).sort((a, b) => str(b.created_at).localeCompare(str(a.created_at)))[0];
}

export const hn: Source = {
  name: 'hn',
  async fetch(ctx) {
    const thread = await findLatestHiringThread();
    if (!thread) {
      ctx.log('hn: no "Who is hiring" thread found');
      return [];
    }
    ctx.log(`hn: reading ${thread.title}`);
    const item = await fetchJson<HnItem>(`https://hn.algolia.com/api/v1/items/${thread.objectID}`, { timeoutMs: 60_000 });
    return parseHnThread(item);
  },
};
