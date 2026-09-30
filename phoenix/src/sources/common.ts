import type { Ats, RawJob } from '../types.js';

export interface BoardConfig {
  greenhouse: string[];
  lever: string[];
  ashby: string[];
  wwr_feeds: string[];
}

export interface SourceContext {
  /** Free-text searches for sources that support them. */
  queries: string[];
  boards: BoardConfig;
  maxAgeDays: number;
  log: (msg: string) => void;
}

export interface Source {
  name: string;
  fetch(ctx: SourceContext): Promise<RawJob[]>;
}

export function detectAts(url: string | undefined | null): Ats {
  if (!url) return 'other';
  const u = url.toLowerCase();
  if (u.startsWith('mailto:')) return 'email';
  if (u.includes('greenhouse.io')) return 'greenhouse';
  if (u.includes('lever.co')) return 'lever';
  if (u.includes('ashbyhq.com')) return 'ashby';
  if (u.includes('workable.com')) return 'workable';
  return 'other';
}

const REMOTE_NEGATIVE = /\b(no|not|non)[- ]remote\b|\bremote (is )?not (available|possible|an option)\b|\bon-?site only\b/i;
const REMOTE_POSITIVE = /\bremote\b|\bwork from (home|anywhere)\b|\bwfh\b|\bdistributed\b|\banywhere\b/i;
const ONSITE = /\bon-?site\b|\bin-?office\b|\bin person\b|\bhybrid\b/i;

/** true when the texts say remote, false when they say on-site or hybrid without remote, null when silent. */
export function inferRemote(...texts: Array<string | undefined | null>): boolean | null {
  const t = texts.filter(Boolean).join(' \n ');
  if (!t.trim()) return null;
  if (REMOTE_NEGATIVE.test(t)) return false;
  if (REMOTE_POSITIVE.test(t)) return true;
  if (ONSITE.test(t)) return false;
  return null;
}

export function titleCase(token: string): string {
  return token
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

export function firstEmail(text: string): string | undefined {
  const m = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? m[0] : undefined;
}

export function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

export function arr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(str).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}
