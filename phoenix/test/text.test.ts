import { describe, expect, it } from 'vitest';
import { annualUsd, decodeEntities, detectCurrencies, htmlToText, normalizeKey, parseSalary, toIso } from '../src/text.js';

describe('htmlToText', () => {
  it('strips tags and keeps list structure', () => {
    const t = htmlToText('<p>Hello <b>world</b></p><ul><li>one</li><li>two</li></ul>');
    expect(t).toContain('Hello world');
    expect(t).toContain('• one');
    expect(t).toContain('• two');
    expect(t).not.toContain('<');
  });
  it('decodes double-escaped HTML such as Greenhouse content', () => {
    expect(htmlToText('&lt;p&gt;Hi &amp;amp; bye&lt;/p&gt;')).toBe('Hi & bye');
  });
  it('decodes numeric and named entities', () => {
    expect(decodeEntities('caf&eacute; &#233; &#xE9; &euro;')).toBe('caf&eacute; é é €');
  });
});

describe('parseSalary', () => {
  it('reads a USD range with k suffixes', () => {
    expect(parseSalary('$120k - $150k USD per year')).toMatchObject({ min: 120000, max: 150000, currency: 'USD', period: 'year' });
  });
  it('reads euros with thousands separators', () => {
    expect(parseSalary('€90,000')).toMatchObject({ min: 90000, currency: 'EUR' });
  });
  it('detects hourly rates', () => {
    expect(parseSalary('$80/hour')).toMatchObject({ min: 80, period: 'hour', currency: 'USD' });
  });
  it('keeps text without numbers as raw only', () => {
    expect(parseSalary('Competitive')).toEqual({ raw: 'Competitive' });
  });
});

describe('detectCurrencies and annualUsd', () => {
  it('finds several currencies in one text', () => {
    expect(detectCurrencies('Salary: 100k USD or 90k EUR')).toEqual(['USD', 'EUR']);
  });
  it('treats a bare dollar sign as USD', () => {
    expect(detectCurrencies('$100,000')).toEqual(['USD']);
  });
  it('annualises hourly pay', () => {
    expect(annualUsd({ min: 100, max: 150, currency: 'USD', period: 'hour' })).toBe(300000);
  });
});

describe('helpers', () => {
  it('normalizes accents and punctuation', () => {
    expect(normalizeKey('Grupo Bursátil Mexicano (GBM)')).toBe('grupo bursatil mexicano gbm');
  });
  it('turns unix seconds and ISO strings into ISO', () => {
    expect(toIso(1700000000)).toBe('2023-11-14T22:13:20.000Z');
    expect(toIso('2026-09-27T09:00:00Z')).toBe('2026-09-27T09:00:00.000Z');
    expect(toIso('not a date')).toBeUndefined();
  });
});
