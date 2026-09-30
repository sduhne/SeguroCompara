export type Ats = 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'email' | 'other';

export type SalaryPeriod = 'year' | 'month' | 'hour';

export interface Salary {
  min?: number;
  max?: number;
  currency?: string;
  period?: SalaryPeriod;
  raw?: string;
}

export type JobStatus =
  | 'new'
  | 'shortlisted'
  | 'rejected'
  | 'tailored'
  | 'applied'
  | 'needs_human'
  | 'skipped'
  | 'interview'
  | 'offer'
  | 'closed';

export interface LlmRating {
  fit: number;
  rationale: string;
  concerns: string[];
  model: string;
  ratedAt: string;
}

export interface Job {
  /** `${source}:${externalId}` */
  id: string;
  source: string;
  externalId: string;
  title: string;
  company: string;
  url: string;
  applyUrl?: string;
  description: string;
  location?: string;
  /** true = remote, false = not remote, null = listing does not say */
  remote: boolean | null;
  employmentType?: string;
  salary?: Salary;
  tags: string[];
  postedAt?: string;
  ats: Ats;
  applyEmail?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  score?: number;
  scoreBreakdown?: Record<string, number>;
  rejectedReason?: string;
  llm?: LlmRating;
  status: JobStatus;
}

/** What a source returns before the store stamps timestamps and status. */
export type RawJob = Omit<Job, 'firstSeenAt' | 'lastSeenAt' | 'status' | 'id'> & { id?: string };

export interface Packet {
  jobId: string;
  company: string;
  title: string;
  subject: string;
  coverLetter: string;
  whyMe: string[];
  answers: Record<string, string>;
  generatedAt: string;
  model: string;
}

export type ApplicationStatus = 'prepared' | 'dry_run' | 'submitted' | 'failed' | 'needs_human';

export interface Application {
  jobId: string;
  company: string;
  title: string;
  url: string;
  method: Ats | 'manual';
  status: ApplicationStatus;
  preparedAt: string;
  submittedAt?: string;
  notes?: string;
  screenshot?: string;
  packetPath?: string;
}
