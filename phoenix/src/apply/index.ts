import { existsSync } from 'node:fs';
import type { Config } from '../config.js';
import { answerQuestion, createClient } from '../llm.js';
import { rank } from '../score.js';
import type { Store } from '../store.js';
import { normalizeKey } from '../text.js';
import type { Application, Job } from '../types.js';
import { applyWithBrowser } from './browser.js';
import { writeEmailDraft } from './email.js';

export interface ApplyRunOptions {
  ids?: string[];
  top?: number;
  confirm: boolean;
  headed?: boolean;
  useLlm?: boolean;
  log?: (msg: string) => void;
}

export interface ApplyRunSummary {
  attempted: number;
  submitted: number;
  dryRun: number;
  needsHuman: number;
  failed: number;
  skipped: Array<{ jobId: string; reason: string }>;
}

function sameDay(iso: string | undefined, now: Date): boolean {
  return !!iso && iso.slice(0, 10) === now.toISOString().slice(0, 10);
}

export function selectForApply(store: Store, opts: { ids?: string[]; top?: number }): Job[] {
  const jobs = store.loadJobs();
  if (opts.ids?.length) {
    const wanted = new Set(opts.ids);
    return jobs.filter((j) => wanted.has(j.id));
  }
  return jobs
    .filter((j) => j.status === 'tailored')
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, opts.top ?? 10);
}

export async function runApply(config: Config, store: Store, opts: ApplyRunOptions): Promise<ApplyRunSummary> {
  const log = opts.log ?? (() => {});
  const { profile, contact, cvPath } = config;
  if (!contact) throw new Error('private/contact.yaml is missing; copy private/contact.example.yaml and fill it in');
  if (!cvPath || !existsSync(cvPath)) throw new Error(`CV not found at ${contact.cv_path}; put the file in private/ and set cv_path in private/contact.yaml`);

  const now = new Date();
  const applications = store.loadApplications();
  const submittedToday = applications.filter((a) => a.status === 'submitted' && sameDay(a.submittedAt, now)).length;
  let budget = Math.max(0, profile.apply.daily_cap - submittedToday);
  const cooldownMs = profile.apply.per_company_cooldown_days * 86_400_000;
  const recentCompanies = new Set(
    applications
      .filter((a) => a.status === 'submitted' && a.submittedAt && now.getTime() - Date.parse(a.submittedAt) < cooldownMs)
      .map((a) => normalizeKey(a.company)),
  );

  const client = opts.useLlm === false ? undefined : createClient();
  const summary: ApplyRunSummary = { attempted: 0, submitted: 0, dryRun: 0, needsHuman: 0, failed: 0, skipped: [] };

  for (const job of selectForApply(store, opts)) {
    const packet = store.loadPacket(job.id);
    if (!packet) {
      summary.skipped.push({ jobId: job.id, reason: 'no packet; run tailor first' });
      continue;
    }
    if (recentCompanies.has(normalizeKey(job.company))) {
      summary.skipped.push({ jobId: job.id, reason: `applied to ${job.company} within ${profile.apply.per_company_cooldown_days} days` });
      continue;
    }
    if (opts.confirm && budget <= 0) {
      summary.skipped.push({ jobId: job.id, reason: `daily cap of ${profile.apply.daily_cap} reached` });
      continue;
    }
    summary.attempted++;
    log(`→ ${job.title} — ${job.company} [${job.ats}]`);
    const base: Application = {
      jobId: job.id,
      company: job.company,
      title: job.title,
      url: job.applyUrl ?? job.url,
      method: job.ats,
      status: 'prepared',
      preparedAt: now.toISOString(),
      packetPath: store.packetPath(job.id),
    };

    if (job.ats === 'email' || job.applyEmail) {
      const draft = writeEmailDraft(store, job, packet, contact, cvPath);
      store.recordApplication({ ...base, method: 'email', status: 'needs_human', notes: `Email draft ready: ${draft.path}` });
      setStatus(store, job.id, 'needs_human');
      summary.needsHuman++;
      log(`  email draft written to ${draft.path}`);
      continue;
    }

    if (job.ats !== 'greenhouse' && job.ats !== 'lever' && job.ats !== 'ashby') {
      store.recordApplication({ ...base, method: 'manual', status: 'needs_human', notes: `Apply manually at ${base.url}; packet at ${base.packetPath}` });
      setStatus(store, job.id, 'needs_human');
      summary.needsHuman++;
      log(`  no automated applier for ${job.ats}; queued for you`);
      continue;
    }

    const result = await applyWithBrowser({
      job,
      packet,
      contact,
      profile,
      cvPath,
      store,
      options: {
        confirm: opts.confirm,
        headed: opts.headed ?? profile.apply.headed,
        log,
        askLlm: client ? (q, options) => answerQuestion(client, job, profile, contact, profile.llm, q, options) : undefined,
      },
    });
    log(`  ${result.status}: ${result.notes}`);
    const status = result.status === 'submitted' ? 'submitted' : result.status === 'dry_run' ? 'dry_run' : result.status === 'needs_human' ? 'needs_human' : 'failed';
    store.recordApplication({ ...base, status, notes: result.notes, screenshot: result.screenshot, submittedAt: status === 'submitted' ? new Date().toISOString() : undefined });
    if (status === 'submitted') {
      budget--;
      recentCompanies.add(normalizeKey(job.company));
      setStatus(store, job.id, 'applied');
      summary.submitted++;
    } else if (status === 'dry_run') summary.dryRun++;
    else if (status === 'needs_human') {
      setStatus(store, job.id, 'needs_human');
      summary.needsHuman++;
    } else summary.failed++;
  }
  return summary;
}

function setStatus(store: Store, jobId: string, status: Job['status']): void {
  const jobs = store.loadJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (job) {
    job.status = status;
    store.saveJobs(jobs);
  }
}
