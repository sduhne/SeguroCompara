import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DiscoverSummary } from './discover.js';
import { rank } from './score.js';
import type { Store } from './store.js';
import type { Job, JobStatus } from './types.js';

function money(job: Job): string {
  const s = job.salary;
  if (!s) return '';
  if (s.raw && s.raw.length <= 28) return s.raw;
  const cur = s.currency ?? '';
  const per = s.period === 'hour' ? '/h' : s.period === 'month' ? '/mo' : '';
  if (s.min && s.max) return `${cur} ${s.min}–${s.max}${per}`.trim();
  if (s.min) return `${cur} ${s.min}${per}`.trim();
  return s.raw ?? '';
}

export function buildReport(store: Store): string {
  const jobs = store.loadJobs();
  const apps = store.loadApplications();
  const lastRunPath = join(store.dir, 'last-run.json');
  const lastRun = existsSync(lastRunPath) ? (JSON.parse(readFileSync(lastRunPath, 'utf8')) as DiscoverSummary) : undefined;
  const byStatus = new Map<JobStatus, number>();
  for (const j of jobs) byStatus.set(j.status, (byStatus.get(j.status) ?? 0) + 1);

  const lines: string[] = ['# Phoenix report', '', `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, ''];
  if (lastRun) {
    lines.push(`Last discovery ${lastRun.ranAt.slice(0, 16).replace('T', ' ')}: fetched ${lastRun.fetched}, kept ${lastRun.added} new (${lastRun.dropped} dropped, ${lastRun.duplicates} duplicates), ${lastRun.shortlisted} shortlisted, ${lastRun.total} in store.`, '');
    lines.push('| Source | Jobs | ms | Error |', '| --- | ---: | ---: | --- |');
    for (const [name, s] of Object.entries(lastRun.perSource)) lines.push(`| ${name} | ${s.count} | ${s.ms} | ${s.error ?? ''} |`);
    lines.push('');
  }
  lines.push('## Pipeline', '', '| Status | Jobs |', '| --- | ---: |');
  for (const status of ['shortlisted', 'tailored', 'applied', 'needs_human', 'interview', 'offer', 'new', 'rejected', 'skipped', 'closed'] as JobStatus[]) {
    const n = byStatus.get(status) ?? 0;
    if (n) lines.push(`| ${status} | ${n} |`);
  }
  lines.push('');

  const queue = jobs.filter((j) => j.status === 'shortlisted' || j.status === 'tailored').sort((a, b) => rank(b) - rank(a)).slice(0, 25);
  if (queue.length) {
    lines.push('## Best matches not yet applied to', '', '| Score | Fit | Title | Company | Pay | Location | Status | Link |', '| ---: | ---: | --- | --- | --- | --- | --- | --- |');
    for (const j of queue) lines.push(`| ${j.score ?? ''} | ${j.llm?.fit ?? ''} | ${j.title} | ${j.company} | ${money(j)} | ${j.location ?? ''} | ${j.status} | [open](${j.url}) |`);
    lines.push('');
  }

  const week = Date.now() - 7 * 86_400_000;
  const recent = apps.filter((a) => a.status === 'submitted' && a.submittedAt && Date.parse(a.submittedAt) > week);
  lines.push(`## Applied in the last 7 days (${recent.length})`, '');
  for (const a of recent) lines.push(`- ${a.submittedAt?.slice(0, 10)} ${a.title} — ${a.company} (${a.method}) ${a.url}`);
  lines.push('');

  const human = apps.filter((a) => a.status === 'needs_human');
  if (human.length) {
    lines.push(`## Needs you (${human.length})`, '');
    for (const a of human) lines.push(`- ${a.title} — ${a.company}: ${a.notes ?? ''} ${a.url}`);
    lines.push('');
  }
  return lines.join('\n');
}
