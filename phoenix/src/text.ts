import { createHash } from 'node:crypto';
import type { Salary, SalaryPeriod } from './types.js';

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·',
  copy: '©', reg: '®', trade: '™', euro: '€', pound: '£',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    const v = ENTITIES[e.toLowerCase()];
    return v ?? m;
  });
}

/** Strip HTML to readable plain text. Handles double-escaped HTML (Greenhouse `content`). */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  let s = String(html);
  if (!/<[a-z][^>]*>/i.test(s) && /&lt;[a-z]/i.test(s)) s = decodeEntities(s);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '\n• ');
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|section|article|ul|ol|blockquote|table)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

export function normalizeKey(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function slug(s: string): string {
  return normalizeKey(s).replace(/\s+/g, '-').slice(0, 80);
}

export function shortHash(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 10);
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

export function toIso(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  let d: Date;
  if (typeof value === 'number') d = new Date(value < 1e12 ? value * 1000 : value);
  else if (typeof value === 'string' && /^\d{9,13}$/.test(value)) {
    const n = Number(value);
    d = new Date(n < 1e12 ? n * 1000 : n);
  } else d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const CURRENCY_PATTERNS: Array<[RegExp, string]> = [
  [/\bUSD\b|US\$|\bU\.S\. ?dollars?\b/i, 'USD'],
  [/\bEUR\b|€|\beuros?\b/i, 'EUR'],
  [/\bGBP\b|£/i, 'GBP'],
  [/\bCAD\b|C\$/i, 'CAD'],
  [/\bCHF\b/i, 'CHF'],
  [/\bAUD\b|A\$/i, 'AUD'],
  [/\bMXN\b|\bpesos\b/i, 'MXN'],
  [/\bBRL\b|R\$/i, 'BRL'],
  [/\bINR\b|₹/i, 'INR'],
];

/** Currency codes mentioned anywhere in a text, most specific first. A bare `$` counts as USD only when nothing else matches. */
export function detectCurrencies(text: string): string[] {
  const found: string[] = [];
  for (const [re, code] of CURRENCY_PATTERNS) if (re.test(text) && !found.includes(code)) found.push(code);
  if (found.length === 0 && /\$\s?\d/.test(text)) found.push('USD');
  return found;
}

function toNumber(raw: string): number | undefined {
  const m = raw.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([kK])?/);
  if (!m) return undefined;
  let n = parseFloat(m[1]);
  if (m[2]) n *= 1000;
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

/** Parse a free-text salary such as "$120k - $150k USD per year" or "€90,000". */
export function parseSalary(raw: string | null | undefined): Salary | undefined {
  if (!raw) return undefined;
  const text = String(raw).trim();
  if (!text) return undefined;
  const currency = detectCurrencies(text)[0];
  let period: SalaryPeriod = 'year';
  if (/\b(per|\/|an?)\s*(hour|hr)\b|\bhourly\b/i.test(text)) period = 'hour';
  else if (/\b(per|\/|a)\s*month\b|\bmonthly\b/i.test(text)) period = 'month';
  const nums = text.match(/\d[\d,]*(?:\.\d+)?\s*[kK]?/g)?.map(toNumber).filter((n): n is number => n !== undefined && n > 0) ?? [];
  const money = nums.filter((n) => (period === 'hour' ? n >= 5 : n >= 500));
  if (money.length === 0) return currency ? { currency, period, raw: text } : { raw: text };
  const [a, b] = money;
  return { min: b !== undefined ? Math.min(a, b) : a, max: b !== undefined ? Math.max(a, b) : undefined, currency, period, raw: text };
}

/** Rough annual USD-equivalent for comparing offers; conversion rates are deliberately coarse. */
export function annualUsd(s: Salary | undefined): number | undefined {
  if (!s) return undefined;
  const v = s.max ?? s.min;
  if (!v) return undefined;
  const rate: Record<string, number> = { USD: 1, EUR: 1.1, GBP: 1.3, CAD: 0.73, CHF: 1.15, AUD: 0.65, MXN: 0.055, BRL: 0.19, INR: 0.012 };
  const r = rate[s.currency ?? 'USD'] ?? 1;
  const perYear = s.period === 'hour' ? v * 2000 : s.period === 'month' ? v * 12 : v;
  return Math.round(perYear * r);
}
