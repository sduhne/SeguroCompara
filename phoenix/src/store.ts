import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { Application, Job, Packet, RawJob } from './types.js';
import { normalizeKey } from './text.js';

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (err) {
    throw new Error(`Corrupt JSON at ${path}: ${(err as Error).message}`);
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, path);
}

/** Key that treats the same posting on two boards as one job. */
export function dedupeKey(job: Pick<Job, 'company' | 'title'>): string {
  return `${normalizeKey(job.company)}|${normalizeKey(job.title)}`;
}

export class Store {
  readonly dir: string;
  readonly jobsPath: string;
  readonly applicationsPath: string;
  readonly packetsDir: string;
  readonly screenshotsDir: string;
  readonly outboxDir: string;

  constructor(dir: string) {
    this.dir = dir;
    this.jobsPath = join(dir, 'jobs.json');
    this.applicationsPath = join(dir, 'applications.json');
    this.packetsDir = join(dir, 'packets');
    this.screenshotsDir = join(dir, 'screenshots');
    this.outboxDir = join(dir, 'outbox');
    for (const d of [dir, this.packetsDir, this.screenshotsDir, this.outboxDir]) mkdirSync(d, { recursive: true });
  }

  loadJobs(): Job[] {
    return readJson<Job[]>(this.jobsPath, []);
  }

  saveJobs(jobs: Job[]): void {
    writeJsonAtomic(this.jobsPath, jobs);
  }

  /**
   * Merge freshly discovered jobs into the store. Existing jobs keep their status, score and
   * first-seen date; a job seen again only refreshes `lastSeenAt` and volatile fields.
   */
  upsertJobs(incoming: RawJob[], now = new Date().toISOString()): { added: Job[]; updated: number; duplicates: number } {
    const jobs = this.loadJobs();
    const byId = new Map(jobs.map((j) => [j.id, j]));
    const byKey = new Map(jobs.map((j) => [dedupeKey(j), j]));
    const added: Job[] = [];
    let updated = 0;
    let duplicates = 0;
    for (const raw of incoming) {
      const id = raw.id ?? `${raw.source}:${raw.externalId}`;
      const existing = byId.get(id);
      if (existing) {
        existing.lastSeenAt = now;
        existing.description = raw.description || existing.description;
        existing.salary = raw.salary ?? existing.salary;
        existing.applyUrl = raw.applyUrl ?? existing.applyUrl;
        updated++;
        continue;
      }
      const key = dedupeKey(raw);
      if (byKey.has(key)) {
        duplicates++;
        continue;
      }
      const job: Job = { ...raw, id, firstSeenAt: now, lastSeenAt: now, status: 'new' };
      jobs.push(job);
      byId.set(id, job);
      byKey.set(key, job);
      added.push(job);
    }
    this.saveJobs(jobs);
    return { added, updated, duplicates };
  }

  loadApplications(): Application[] {
    return readJson<Application[]>(this.applicationsPath, []);
  }

  saveApplications(apps: Application[]): void {
    writeJsonAtomic(this.applicationsPath, apps);
  }

  recordApplication(app: Application): void {
    const apps = this.loadApplications().filter((a) => a.jobId !== app.jobId);
    apps.push(app);
    this.saveApplications(apps);
  }

  packetPath(jobId: string): string {
    return join(this.packetsDir, `${jobId.replace(/[^a-z0-9_-]+/gi, '_')}.json`);
  }

  loadPacket(jobId: string): Packet | undefined {
    const p = this.packetPath(jobId);
    return existsSync(p) ? readJson<Packet>(p, undefined as unknown as Packet) : undefined;
  }

  savePacket(packet: Packet): string {
    const p = this.packetPath(packet.jobId);
    writeJsonAtomic(p, packet);
    const md = [
      `# ${packet.title} — ${packet.company}`,
      '',
      `Subject: ${packet.subject}`,
      '',
      '## Cover letter',
      '',
      packet.coverLetter,
      '',
      '## Why me (talking points)',
      '',
      ...packet.whyMe.map((w) => `- ${w}`),
      '',
      '## Screening answers',
      '',
      ...Object.entries(packet.answers).map(([q, a]) => `**${q}**\n\n${a}\n`),
    ].join('\n');
    writeFileSync(p.replace(/\.json$/, '.md'), md);
    return p;
  }
}
