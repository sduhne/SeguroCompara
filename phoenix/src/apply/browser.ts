import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Locator, type Page } from 'playwright';
import type { Contact, Profile } from '../config.js';
import type { Store } from '../store.js';
import type { Job, Packet } from '../types.js';
import { bankAnswer, classifyField, pickOption, valueFor, type FieldIntent, type ValueContext } from './forms.js';

export interface BrowserApplyOptions {
  confirm: boolean;
  headed: boolean;
  timeoutMs?: number;
  /** Called for questions the profile cannot answer; return undefined to leave the field blank. */
  askLlm?: (question: string, options?: string[]) => Promise<string | undefined>;
  log?: (msg: string) => void;
}

export interface BrowserApplyResult {
  status: 'dry_run' | 'submitted' | 'needs_human' | 'failed';
  notes: string;
  screenshot?: string;
  filled: string[];
  unanswered: string[];
}

interface FieldInfo {
  index: number;
  label: string;
  name: string;
  type: string;
  tag: string;
  placeholder: string;
  required: boolean;
  options?: string[];
  radioLabel?: string;
}

const FIELD_SELECTOR = 'form input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]), form textarea, form select';
const CAPTCHA_SELECTOR = 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], .g-recaptcha, .h-captcha, [data-sitekey]';
const SUBMIT_SELECTOR = 'form button[type=submit], form input[type=submit], form button:has-text("Submit"), button:has-text("Submit application"), button:has-text("Submit Application")';
const CONFIRMATION = /thank you|thanks for applying|application (has been |was )?(submitted|received|sent)|we('ve| have) received your application|successfully submitted|gracias por (tu|su) (aplicaci|postulaci)/i;

async function describeFields(page: Page): Promise<FieldInfo[]> {
  return page.evaluate((selector) => {
    const els = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector));
    const text = (n: Element | null | undefined) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return els.map((el, index) => {
      let label = '';
      if (el.id) label = text(document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
      if (!label) label = text(el.closest('label'));
      const by = el.getAttribute('aria-labelledby');
      if (!label && by) label = by.split(/\s+/).map((i) => text(document.getElementById(i))).join(' ');
      if (!label) label = el.getAttribute('aria-label') ?? '';
      const fieldset = el.closest('fieldset');
      if (!label && fieldset) label = text(fieldset.querySelector('legend'));
      if (!label) {
        const wrap = el.closest('div, li, tr, section');
        label = text(wrap?.querySelector('label, legend, h3, h4, h5, [class*="label" i], [class*="question" i], [class*="title" i]'));
      }
      const tag = el.tagName.toLowerCase();
      const type = (el as HTMLInputElement).type ?? tag;
      let radioLabel: string | undefined;
      if (type === 'radio' || type === 'checkbox') {
        radioLabel = text(el.closest('label')) || (el.id ? text(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) : '');
        const group = fieldset ?? el.closest('[role=group], [role=radiogroup], div');
        const groupLabel = text(group?.querySelector('legend, [id$="label"], .label, h3, h4, [class*="label" i], [class*="question" i]'));
        if (groupLabel && groupLabel !== radioLabel) label = groupLabel;
      }
      const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) || type === 'file';
      return {
        index,
        label,
        name: el.getAttribute('name') ?? '',
        type,
        tag,
        placeholder: (el as HTMLInputElement).placeholder ?? '',
        required: el.required || el.getAttribute('aria-required') === 'true' || /\*/.test(label),
        options: tag === 'select' ? Array.from((el as HTMLSelectElement).options).map((o) => o.text.trim()) : undefined,
        radioLabel,
        visible,
      };
    }).filter((f) => f.visible);
  }, FIELD_SELECTOR);
}

async function openForm(page: Page, job: Job, timeoutMs: number): Promise<void> {
  const url = job.applyUrl ?? job.url;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  if (await page.locator(FIELD_SELECTOR).count()) return;
  const openers = [
    page.getByRole('link', { name: /apply/i }).first(),
    page.getByRole('button', { name: /apply/i }).first(),
    page.locator('a:has-text("Apply"), button:has-text("Apply")').first(),
  ];
  for (const opener of openers) {
    if (await opener.count()) {
      await opener.click({ timeout: 5_000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      if (await page.locator(FIELD_SELECTOR).count()) return;
    }
  }
  if (job.ats === 'lever' && !/\/apply\/?$/.test(page.url())) await page.goto(url.replace(/\/?$/, '/apply'), { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  if (job.ats === 'ashby' && !/\/application\/?$/.test(page.url())) await page.goto(url.replace(/\/?$/, '/application'), { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.waitForSelector(FIELD_SELECTOR, { timeout: 15_000 });
}

async function fillCombobox(locator: Locator, value: string): Promise<void> {
  await locator.click();
  await locator.fill(value);
  await locator.page().waitForTimeout(600);
  const option = locator.page().getByRole('option', { name: new RegExp(value.split(/[,(]/)[0].trim(), 'i') }).first();
  if (await option.count()) await option.click();
  else await locator.press('Enter');
}

export async function applyWithBrowser(args: {
  job: Job;
  packet: Packet;
  contact: Contact;
  profile: Profile;
  cvPath: string;
  store: Store;
  options: BrowserApplyOptions;
}): Promise<BrowserApplyResult> {
  const { job, packet, contact, profile, cvPath, store, options } = args;
  const log = options.log ?? (() => {});
  const timeoutMs = options.timeoutMs ?? 45_000;
  const ctx: ValueContext = { contact, profile, packet };
  const filled: string[] = [];
  const unanswered: string[] = [];
  const browser = await chromium.launch({ headless: !options.headed, executablePath: process.env.PHOENIX_CHROMIUM_PATH || undefined });
  const screenshot = join(store.screenshotsDir, `${job.id.replace(/[^a-z0-9_-]+/gi, '_')}.png`);
  try {
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 1800 } });
    const page = await context.newPage();
    await openForm(page, job, timeoutMs);

    const coverLetterFile = join(store.packetsDir, `${job.id.replace(/[^a-z0-9_-]+/gi, '_')}-cover-letter.txt`);
    writeFileSync(coverLetterFile, packet.coverLetter);

    const fields = await describeFields(page);
    const all = page.locator(FIELD_SELECTOR);
    const handledRadioGroups = new Set<string>();

    for (const f of fields) {
      const locator = all.nth(f.index);
      const intent: FieldIntent = classifyField(f.label, { name: f.name, type: f.type, placeholder: f.placeholder });
      const describe = `${f.label || f.name || f.type}`;
      try {
        if (f.type === 'file') {
          const file = intent === 'cover_letter' ? coverLetterFile : cvPath;
          await locator.setInputFiles(file);
          filled.push(`${describe} ← ${intent === 'cover_letter' ? 'cover letter' : 'CV'}`);
          continue;
        }
        if (f.type === 'checkbox') {
          if (intent === 'consent' || /consent|agree|acknowledge|privacy|certify/i.test(f.radioLabel ?? '')) {
            await locator.check().catch(() => {});
            filled.push(`${describe} ← checked`);
          }
          continue;
        }
        if (f.type === 'radio') {
          const groupKey = f.name || f.label;
          if (handledRadioGroups.has(groupKey)) continue;
          handledRadioGroups.add(groupKey);
          const group = fields.filter((g) => g.type === 'radio' && (g.name || g.label) === groupKey);
          const labels = group.map((g) => g.radioLabel ?? '').filter(Boolean);
          let choice = pickOption(intent, labels, ctx, f.label);
          if (!choice && intent === 'unknown') choice = await resolveUnknown(f.label, labels);
          if (choice) {
            const target = group.find((g) => g.radioLabel === choice);
            if (target) {
              await all.nth(target.index).check({ force: true });
              filled.push(`${describe} ← ${choice}`);
            }
          } else if (f.required) unanswered.push(describe);
          continue;
        }
        if (f.tag === 'select') {
          const options = f.options ?? [];
          let choice = pickOption(intent, options, ctx, f.label);
          if (!choice && intent === 'unknown') choice = await resolveUnknown(f.label, options);
          if (choice) {
            await locator.selectOption({ label: choice });
            filled.push(`${describe} ← ${choice}`);
          } else if (f.required) unanswered.push(describe);
          continue;
        }
        let value = valueFor(intent, ctx);
        if (value === undefined && intent === 'unknown') value = await resolveUnknown(f.label);
        if (value === undefined && intent === 'cover_letter') value = packet.coverLetter;
        if (value !== undefined && value !== '') {
          const role = await locator.getAttribute('role');
          if (role === 'combobox' || (await locator.getAttribute('aria-autocomplete'))) await fillCombobox(locator, value);
          else await locator.fill(value);
          filled.push(`${describe} ← ${value.length > 40 ? value.slice(0, 37) + '…' : value}`);
        } else if (f.required && intent !== 'pronouns') unanswered.push(describe);
      } catch (err) {
        log(`  could not fill "${describe}": ${(err as Error).message.split('\n')[0]}`);
        if (f.required) unanswered.push(describe);
      }
    }

    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    const captcha = (await page.locator(CAPTCHA_SELECTOR).count()) > 0;

    if (!options.confirm) return { status: 'dry_run', notes: `Filled ${filled.length} fields; ${unanswered.length} unanswered${captcha ? '; captcha present' : ''}`, screenshot, filled, unanswered };
    if (unanswered.length) return { status: 'needs_human', notes: `Unanswered required fields: ${unanswered.join(' | ')}`, screenshot, filled, unanswered };
    if (captcha && !options.headed) return { status: 'needs_human', notes: 'Captcha on the form; rerun with --headed and solve it', screenshot, filled, unanswered };

    const submit = page.locator(SUBMIT_SELECTOR).first();
    if (!(await submit.count())) return { status: 'failed', notes: 'No submit button found', screenshot, filled, unanswered };
    await submit.click();
    const confirmed = await Promise.race([
      page.waitForFunction((re) => new RegExp(re, 'i').test(document.body.innerText), CONFIRMATION.source, { timeout: 30_000 }).then(() => true),
      page.waitForTimeout(30_000).then(() => false),
    ]).catch(() => false);
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    const errors = await page.locator('[aria-invalid="true"], .field_error, .error, [class*="error" i]:visible').count().catch(() => 0);
    if (confirmed) return { status: 'submitted', notes: `Submitted; ${filled.length} fields`, screenshot, filled, unanswered };
    return { status: 'failed', notes: errors ? `Form reported ${errors} validation error(s) after submit` : 'No confirmation message after submit; check the screenshot', screenshot, filled, unanswered };
  } catch (err) {
    return { status: 'failed', notes: (err as Error).message.split('\n')[0], screenshot, filled, unanswered };
  } finally {
    await browser.close();
  }

  async function resolveUnknown(question: string, choices?: string[]): Promise<string | undefined> {
    if (!question) return undefined;
    const fromBank = bankAnswer(question, profile);
    if (fromBank && !choices) return fromBank;
    if (choices?.length && fromBank) {
      const hit = choices.find((o) => fromBank.toLowerCase().includes(o.toLowerCase()));
      if (hit) return hit;
    }
    if (options.askLlm) {
      const answer = await options.askLlm(question, choices);
      if (answer) log(`  Claude answered "${question}"`);
      return answer;
    }
    return undefined;
  }
}
