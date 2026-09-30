import { XMLParser } from 'fast-xml-parser';
import type { RawJob } from '../types.js';
import { htmlToText, shortHash, toIso } from '../text.js';
import { detectAts, str, type Source } from './common.js';
import { fetchText } from './http.js';

interface RssItem {
  title?: unknown;
  link?: unknown;
  description?: unknown;
  pubDate?: unknown;
  guid?: unknown;
  region?: unknown;
  type?: unknown;
  category?: unknown;
}

function text(v: unknown): string {
  if (v && typeof v === 'object' && '#text' in (v as Record<string, unknown>)) return str((v as Record<string, unknown>)['#text']);
  return str(v);
}

export function parseWwrRss(xml: string): RawJob[] {
  const parser = new XMLParser({ ignoreAttributes: false, textNodeName: '#text' });
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: RssItem | RssItem[] } } };
  const raw = doc?.rss?.channel?.item;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return items
    .map((it) => {
      const full = text(it.title).trim();
      const link = text(it.link).trim();
      if (!full || !link) return undefined;
      const sep = full.indexOf(': ');
      const company = sep > 0 ? full.slice(0, sep).trim() : '';
      const title = sep > 0 ? full.slice(sep + 2).trim() : full;
      const guid = text(it.guid).trim() || link;
      const region = text(it.region).trim();
      const job: RawJob = {
        source: 'weworkremotely',
        externalId: shortHash(guid),
        title,
        company,
        url: link,
        description: htmlToText(text(it.description)),
        location: region || undefined,
        remote: true,
        employmentType: text(it.type).trim() || undefined,
        tags: [text(it.category).trim()].filter(Boolean),
        postedAt: toIso(text(it.pubDate)),
        ats: detectAts(link),
      };
      return job;
    })
    .filter((j): j is RawJob => j !== undefined);
}

export const weworkremotely: Source = {
  name: 'weworkremotely',
  async fetch(ctx) {
    const out: RawJob[] = [];
    for (const feed of ctx.boards.wwr_feeds) {
      const xml = await fetchText(feed);
      out.push(...parseWwrRss(xml));
    }
    return out;
  },
};
