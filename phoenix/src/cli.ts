#!/usr/bin/env -S npx tsx
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { runApply } from './apply/index.js';
import { loadConfig } from './config.js';
import { discover, enabledSources } from './discover.js';
import { buildReport } from './report.js';
import { rank } from './score.js';
import { Store } from './store.js';
import { exportForTailoring, importPackets, rate, tailor, tailorBatchCollect, tailorBatchSubmit } from './tailor.js';
import type { Job, JobStatus } from './types.js';

const program = new Command();
program.name('phoenix').description('Remote job search pipeline: discover, score, tailor, apply, track.').version('0.1.0');

const log = (msg: string) => console.log(msg);

function open() {
  const config = loadConfig();
  const store = new Store(config.dataDir);
  return { config, store };
}

function csv(value?: string): string[] | undefined {
  return value ? value.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
}

function line(j: Job): string {
  const score = String(j.score ?? '').padStart(3);
  const fit = j.llm ? `/${String(j.llm.fit).padStart(3)}` : '    ';
  return `${score}${fit}  ${j.status.padEnd(11)} ${j.title.slice(0, 48).padEnd(48)} ${j.company.slice(0, 24).padEnd(24)} ${j.ats.padEnd(10)} ${j.id}`;
}

program
  .command('init')
  .description('Create private/contact.yaml from the example')
  .action(() => {
    const { config } = open();
    const target = join(config.root, 'private', 'contact.yaml');
    if (existsSync(target)) return log(`${target} already exists`);
    copyFileSync(join(config.root, 'private', 'contact.example.yaml'), target);
    log(`Created ${target}; fill it in and drop your CV in private/`);
  });

program
  .command('sources')
  .description('List enabled sources')
  .action(() => {
    const { config } = open();
    log(enabledSources(config).join('\n'));
  });

program
  .command('discover')
  .description('Pull listings from every enabled source, filter, score, and store them')
  .option('-s, --sources <names>', 'comma-separated subset of sources')
  .option('--fixture <path>', 'read raw jobs from a JSON file instead of the network')
  .action(async (opts: { sources?: string; fixture?: string }) => {
    const { config, store } = open();
    const s = await discover(config, store, { sources: csv(opts.sources), fixture: opts.fixture, log });
    log(`\nfetched ${s.fetched}, dropped ${s.dropped} (filters/floor), added ${s.added}, refreshed ${s.updated}, duplicates ${s.duplicates}`);
    log(`shortlisted ${s.shortlisted} of ${s.total} stored jobs`);
  });

program
  .command('score')
  .description('Re-score stored jobs; with --llm, ask Claude for a fit rating on the shortlist')
  .option('--llm', 'add Claude ratings')
  .option('-n, --top <n>', 'how many to rate', '40')
  .option('--ids <ids>', 'comma-separated job ids')
  .option('--force', 'rate again even if rated')
  .action(async (opts: { llm?: boolean; top: string; ids?: string; force?: boolean }) => {
    const { config, store } = open();
    const { applyScores } = await import('./score.js');
    const jobs = store.loadJobs();
    const r = applyScores(jobs, config.profile.search);
    store.saveJobs(jobs);
    log(`re-scored ${jobs.length} jobs: ${r.shortlisted} shortlisted, ${r.rejected} rejected`);
    if (opts.llm) {
      const out = await rate(config, store, { top: Number(opts.top), ids: csv(opts.ids), force: opts.force, log });
      log(`Claude rated ${out.rated} (${out.failed} failed)`);
    }
  });

program
  .command('list')
  .description('Show stored jobs, best first')
  .option('--status <status>', 'filter by status (shortlisted, tailored, applied, needs_human, new, rejected)')
  .option('-n, --top <n>', 'rows', '30')
  .option('--json', 'print JSON')
  .action((opts: { status?: string; top: string; json?: boolean }) => {
    const { store } = open();
    let jobs = store.loadJobs();
    if (opts.status) jobs = jobs.filter((j) => j.status === opts.status);
    else jobs = jobs.filter((j) => j.status !== 'rejected');
    jobs = jobs.sort((a, b) => rank(b) - rank(a)).slice(0, Number(opts.top));
    if (opts.json) return log(JSON.stringify(jobs, null, 2));
    log('score/fit status      title                                            company                  ats        id');
    for (const j of jobs) log(line(j));
  });

program
  .command('show <id>')
  .description('Print one job with its score breakdown and packet, if any')
  .action((id: string) => {
    const { store } = open();
    const job = store.loadJobs().find((j) => j.id === id);
    if (!job) throw new Error(`No job ${id}`);
    const { description, ...rest } = job;
    log(JSON.stringify(rest, null, 2));
    log('\n' + description.slice(0, 3000));
    const packet = store.loadPacket(id);
    if (packet) log(`\n--- packet ---\n${packet.coverLetter}`);
  });

program
  .command('tailor')
  .description('Write cover letters and screening answers for shortlisted jobs with Claude')
  .option('-n, --top <n>', 'how many', '10')
  .option('--ids <ids>', 'comma-separated job ids')
  .option('--force', 'rewrite existing packets')
  .option('--batch', 'submit as a Message Batch (half price, results within hours)')
  .option('--collect <batchId>', 'fetch the results of a submitted batch')
  .option('--export <path>', 'write a bundle to tailor without an API key (in a Claude Code session)')
  .option('--import <path>', 'load packets written from an exported bundle')
  .action(async (opts: { top: string; ids?: string; force?: boolean; batch?: boolean; collect?: string; export?: string; import?: string }) => {
    const { config, store } = open();
    if (opts.export) {
      const r = exportForTailoring(config, store, { top: Number(opts.top), ids: csv(opts.ids), force: opts.force }, opts.export);
      return log(`exported ${r.count} jobs to ${r.path}`);
    }
    if (opts.import) {
      const r = importPackets(store, opts.import);
      log(`imported ${r.done.length} packets; ${r.failed.length} failed`);
      for (const f of r.failed) log(`  ${f.id}: ${f.error}`);
      return;
    }
    if (opts.collect) {
      const r = await tailorBatchCollect(config, store, opts.collect);
      if (r.status === 'pending') return log('batch still processing; try again later');
      log(`collected ${r.done} packets; ${r.failed.length} failed`);
      for (const f of r.failed) log(`  ${f.jobId}: ${f.error}`);
      return;
    }
    if (opts.batch) {
      const r = await tailorBatchSubmit(config, store, { top: Number(opts.top), ids: csv(opts.ids), force: opts.force });
      return log(`submitted batch ${r.batchId} with ${r.count} jobs; run: phoenix tailor --collect ${r.batchId}`);
    }
    const r = await tailor(config, store, { top: Number(opts.top), ids: csv(opts.ids), force: opts.force, log });
    log(`tailored ${r.done.length}; ${r.failed.length} failed`);
  });

program
  .command('apply')
  .description('Fill application forms for tailored jobs. Dry run by default; --confirm submits.')
  .option('-n, --top <n>', 'how many', '10')
  .option('--ids <ids>', 'comma-separated job ids')
  .option('--confirm', 'actually submit (respects the daily cap and company cooldown)')
  .option('--headed', 'show the browser (needed to solve captchas)')
  .option('--no-llm', 'do not ask Claude for unknown questions')
  .action(async (opts: { top: string; ids?: string; confirm?: boolean; headed?: boolean; llm: boolean }) => {
    const { config, store } = open();
    const s = await runApply(config, store, { top: Number(opts.top), ids: csv(opts.ids), confirm: !!opts.confirm, headed: opts.headed, useLlm: opts.llm, log });
    log(`\nattempted ${s.attempted}: submitted ${s.submitted}, dry-run ${s.dryRun}, needs you ${s.needsHuman}, failed ${s.failed}, skipped ${s.skipped.length}`);
    for (const k of s.skipped) log(`  skipped ${k.jobId}: ${k.reason}`);
    if (!opts.confirm) log('\nThis was a dry run. Check data/screenshots/, then rerun with --confirm to submit.');
  });

program
  .command('status <id> <status> [note]')
  .description('Set a job status by hand (applied, interview, offer, rejected, skipped, closed)')
  .action((id: string, status: string, note?: string) => {
    const { store } = open();
    const allowed: JobStatus[] = ['new', 'shortlisted', 'rejected', 'tailored', 'applied', 'needs_human', 'skipped', 'interview', 'offer', 'closed'];
    if (!allowed.includes(status as JobStatus)) throw new Error(`status must be one of ${allowed.join(', ')}`);
    const jobs = store.loadJobs();
    const job = jobs.find((j) => j.id === id);
    if (!job) throw new Error(`No job ${id}`);
    job.status = status as JobStatus;
    store.saveJobs(jobs);
    if (note) {
      const apps = store.loadApplications();
      const app = apps.find((a) => a.jobId === id);
      if (app) {
        app.notes = `${app.notes ?? ''}\n${new Date().toISOString().slice(0, 10)}: ${note}`.trim();
        store.saveApplications(apps);
      }
    }
    log(`${job.title} — ${job.company}: ${status}`);
  });

program
  .command('report')
  .description('Write a Markdown digest of the pipeline')
  .option('-o, --out <path>', 'file to write (default: data/report.md)')
  .action((opts: { out?: string }) => {
    const { store } = open();
    const md = buildReport(store);
    const out = opts.out ?? join(store.dir, 'report.md');
    writeFileSync(out, md);
    log(md);
    log(`\nwritten to ${out}`);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`error: ${(err as Error).message}`);
  process.exit(1);
});
