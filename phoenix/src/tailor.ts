import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.js';
import { z } from 'zod';
import { collectTailorBatch, createClient, PacketSchema, packetFromValue, rateJob, STANDARD_QUESTIONS, submitTailorBatch, systemPrompt, tailorJob, tailorPrompt } from './llm.js';
import { rank } from './score.js';
import type { Store } from './store.js';
import type { Job } from './types.js';

export interface SelectOptions {
  ids?: string[];
  top?: number;
  force?: boolean;
}

/** Shortlisted jobs, best first, skipping ones that already have a packet unless forced. */
export function selectForTailoring(store: Store, opts: SelectOptions): Job[] {
  const jobs = store.loadJobs();
  if (opts.ids?.length) {
    const wanted = new Set(opts.ids);
    return jobs.filter((j) => wanted.has(j.id));
  }
  return jobs
    .filter((j) => (j.status === 'shortlisted' || (opts.force && j.status === 'tailored')) && (opts.force || !store.loadPacket(j.id)))
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, opts.top ?? 10);
}

export async function rate(config: Config, store: Store, opts: { top?: number; ids?: string[]; force?: boolean; log?: (m: string) => void }): Promise<{ rated: number; failed: number }> {
  const log = opts.log ?? (() => {});
  const client = createClient();
  const jobs = store.loadJobs();
  const wanted = opts.ids?.length ? new Set(opts.ids) : undefined;
  const targets = jobs
    .filter((j) => (wanted ? wanted.has(j.id) : j.status === 'shortlisted' || j.status === 'tailored') && (opts.force || !j.llm))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, opts.top ?? 40);
  let rated = 0;
  let failed = 0;
  for (const job of targets) {
    try {
      job.llm = await rateJob(client, job, config.profile, config.contact, config.profile.llm);
      rated++;
      log(`  ${job.llm.fit.toString().padStart(3)}  ${job.title} — ${job.company}`);
      store.saveJobs(jobs);
    } catch (err) {
      failed++;
      log(`  failed ${job.id}: ${(err as Error).message}`);
    }
  }
  return { rated, failed };
}

export async function tailor(config: Config, store: Store, opts: SelectOptions & { log?: (m: string) => void }): Promise<{ done: string[]; failed: Array<{ id: string; error: string }> }> {
  const log = opts.log ?? (() => {});
  const client = createClient();
  const targets = selectForTailoring(store, opts);
  const done: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const job of targets) {
    try {
      const packet = await tailorJob(client, job, config.profile, config.contact, config.profile.llm);
      const path = store.savePacket(packet);
      markTailored(store, job.id);
      done.push(job.id);
      log(`  wrote ${path}`);
    } catch (err) {
      failed.push({ id: job.id, error: (err as Error).message });
      log(`  failed ${job.id}: ${(err as Error).message}`);
    }
  }
  return { done, failed };
}

function markTailored(store: Store, jobId: string): void {
  const jobs = store.loadJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (job && (job.status === 'shortlisted' || job.status === 'new')) {
    job.status = 'tailored';
    store.saveJobs(jobs);
  }
}

/**
 * Bundle for tailoring without an API key: a Claude Code session (or you) reads this file, writes
 * one packet per job in the documented shape, and `importPackets` loads them.
 */
export function exportForTailoring(config: Config, store: Store, opts: SelectOptions, outPath: string): { count: number; path: string } {
  const targets = selectForTailoring(store, { ...opts, top: opts.top ?? 15 });
  const bundle = {
    instructions: [
      'For each job below, write one packet object and collect them in a JSON array.',
      'Packet shape: {"jobId": string, "subject": string, "cover_letter": string, "why_me": string[3-5], "answers": [{"question": string, "answer": string}], "language": "en"|"es"}.',
      'Follow the writer rules and use only facts from the dossier. Then run: phoenix tailor --import <file>.',
    ],
    writer_rules_and_dossier: systemPrompt(config.profile, config.contact),
    questions: STANDARD_QUESTIONS,
    jobs: targets.map((job) => ({ jobId: job.id, prompt: tailorPrompt(job, STANDARD_QUESTIONS) })),
  };
  writeFileSync(outPath, JSON.stringify(bundle, null, 2) + '\n');
  return { count: targets.length, path: outPath };
}

const ImportedPacket = PacketSchema.extend({ jobId: z.string() });

export function importPackets(store: Store, file: string): { done: string[]; failed: Array<{ id: string; error: string }> } {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  const items = Array.isArray(raw) ? raw : (raw as { packets?: unknown[] })?.packets ?? [];
  const jobs = store.loadJobs();
  const done: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const item of items) {
    const parsed = ImportedPacket.safeParse(item);
    const id = (item as { jobId?: string })?.jobId ?? '?';
    if (!parsed.success) {
      failed.push({ id, error: z.prettifyError(parsed.error).split('\n')[0] });
      continue;
    }
    const job = jobs.find((j) => j.id === parsed.data.jobId);
    if (!job) {
      failed.push({ id, error: 'unknown job id' });
      continue;
    }
    store.savePacket(packetFromValue(job, parsed.data, 'session'));
    markTailored(store, job.id);
    done.push(job.id);
  }
  return { done, failed };
}

interface BatchRecord {
  batchId: string;
  jobIds: string[];
  submittedAt: string;
  collectedAt?: string;
}

function batchesPath(store: Store): string {
  return join(store.dir, 'batches.json');
}

function loadBatches(store: Store): BatchRecord[] {
  const p = batchesPath(store);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as BatchRecord[]) : [];
}

export async function tailorBatchSubmit(config: Config, store: Store, opts: SelectOptions): Promise<{ batchId: string; count: number }> {
  const client = createClient();
  const targets = selectForTailoring(store, { ...opts, top: opts.top ?? 100 });
  if (targets.length === 0) throw new Error('Nothing to tailor: no shortlisted jobs without a packet');
  const batchId = await submitTailorBatch(client, targets, config.profile, config.contact, config.profile.llm);
  const records = loadBatches(store);
  records.push({ batchId, jobIds: targets.map((j) => j.id), submittedAt: new Date().toISOString() });
  writeFileSync(batchesPath(store), JSON.stringify(records, null, 2) + '\n');
  return { batchId, count: targets.length };
}

export async function tailorBatchCollect(config: Config, store: Store, batchId: string): Promise<{ status: 'pending' | 'ended'; done: number; failed: Array<{ jobId: string; error: string }> }> {
  const client = createClient();
  const records = loadBatches(store);
  const record = records.find((r) => r.batchId === batchId);
  if (!record) throw new Error(`Unknown batch ${batchId}; see data/batches.json`);
  const jobs = store.loadJobs().filter((j) => record.jobIds.includes(j.id));
  const outcome = await collectTailorBatch(client, batchId, jobs);
  if (outcome.status === 'pending') return { status: 'pending', done: 0, failed: [] };
  for (const packet of outcome.packets) {
    store.savePacket(packet);
    markTailored(store, packet.jobId);
  }
  record.collectedAt = new Date().toISOString();
  writeFileSync(batchesPath(store), JSON.stringify(records, null, 2) + '\n');
  return { status: 'ended', done: outcome.packets.length, failed: outcome.failed };
}
