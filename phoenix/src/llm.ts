import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { Contact, LlmConfig, Profile } from './config.js';
import { truncate } from './text.js';
import type { Job, LlmRating, Packet } from './types.js';

export function createClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn('ANTHROPIC_API_KEY is not set; the SDK will look for an `ant auth login` profile.');
  }
  return new Anthropic();
}

/** Everything Claude may say about the candidate. Stable across calls, so it is cached. */
export function buildDossier(profile: Profile, contact?: Contact): string {
  const c = profile.candidate;
  const lines: string[] = [
    `Name: ${c.name}`,
    `Headline: ${c.headline}`,
    `Location: ${c.location} (${c.timezone})`,
    `Languages: ${c.languages.join('; ')}`,
    contact?.linkedin ? `LinkedIn: ${contact.linkedin}` : '',
    '',
    'Summary:',
    c.summary,
    '',
    'Experience:',
  ];
  for (const e of c.experience) {
    lines.push(`- ${e.title}, ${e.company} (${e.period})${e.summary ? ` — ${e.summary}` : ''}`);
    for (const bl of e.bullets) lines.push(`    • ${bl}`);
  }
  lines.push('', 'Education:', ...c.education.map((e) => `- ${e}`));
  lines.push('', 'Skills:', ...c.skills.map((s) => `- ${s}`));
  lines.push('', `Work authorization: ${c.work_authorization}`);
  lines.push(`Availability: ${c.availability}`);
  lines.push(`Engagement types: ${c.engagement_types.join(', ')}`);
  lines.push(
    `Compensation floor: USD ${c.compensation.full_time_usd_year_min}/year full-time, USD ${c.compensation.part_time_usd_hour_min}/hour part-time, USD ${c.compensation.consulting_usd_day_min}/day consulting`,
  );
  if (profile.qa_bank.length) {
    lines.push('', 'Standard answers the candidate has approved:');
    for (const qa of profile.qa_bank) lines.push(`Q: ${qa.q}\nA: ${qa.a}`);
  }
  return lines.filter((l) => l !== undefined).join('\n');
}

const WRITER_RULES = `You write job applications for one candidate, in the candidate's own voice: direct, specific, plain. No clichés ("passionate", "dynamic", "leverage", "synergy"), no exclamation marks, no flattery of the company. Never invent employers, dates, numbers, credentials, tools or results; every fact must come from the dossier. If the posting asks for something the candidate lacks, name the closest true thing instead of claiming it. Write in the language of the posting (English or Spanish). Match the posting's spelling (US or UK).`;

export function systemPrompt(profile: Profile, contact?: Contact): string {
  return `${WRITER_RULES}\n\n<candidate_dossier>\n${buildDossier(profile, contact)}\n</candidate_dossier>`;
}

export function jobBlock(job: Job): string {
  const salary = job.salary?.raw ?? (job.salary?.min ? `${job.salary.currency ?? ''} ${job.salary.min}${job.salary.max ? `–${job.salary.max}` : ''} per ${job.salary.period ?? 'year'}` : 'not stated');
  return [
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    `Location: ${job.location ?? 'not stated'}`,
    `Employment type: ${job.employmentType ?? 'not stated'}`,
    `Salary: ${salary}`,
    `Source: ${job.source} (${job.url})`,
    '',
    '<posting>',
    truncate(job.description, 14_000),
    '</posting>',
  ].join('\n');
}

export const RatingSchema = z.object({
  fit: z.number().min(0).max(100).describe('0-100: how likely this candidate is to get an interview for this posting'),
  rationale: z.string().describe('Two or three sentences, specific to the posting'),
  concerns: z.array(z.string()).describe('Concrete gaps or risks, empty if none'),
  remote_from_mexico_ok: z.boolean().describe('Whether the posting allows a contractor or remote employee based in Mexico'),
  seniority_match: z.boolean(),
  language: z.string().describe('Language of the posting, e.g. "en" or "es"'),
});

export const PacketSchema = z.object({
  subject: z.string().describe('Email subject line for the application, under 80 characters'),
  cover_letter: z.string().describe('Under 260 words. Paragraph 1: why this company and role, citing one specific detail from the posting. Paragraph 2: the two or three most relevant results from the dossier, with numbers. Paragraph 3: logistics (remote from Mexico City on Central Time, engagement type, availability). Sign with the candidate name.'),
  why_me: z.array(z.string()).min(3).max(5).describe('Talking points for the recruiter screen, one sentence each'),
  answers: z.array(z.object({ question: z.string(), answer: z.string() })).describe('Answers to the screening questions, each under 120 words'),
  language: z.string(),
});

export const STANDARD_QUESTIONS = [
  'Why are you interested in this role and company?',
  'What makes you a strong fit for this role?',
  'Describe a relevant result you delivered, with numbers.',
];

interface StructuredArgs<T> {
  client: Anthropic;
  llm: LlmConfig;
  system: string;
  user: string;
  schema: z.ZodType<T>;
}

/**
 * One structured-output call. Uses the server-side refusal fallback so a rare safety decline is
 * retried on a fallback model inside the same request instead of failing the job.
 */
export async function structured<T>({ client, llm, system, user, schema }: StructuredArgs<T>): Promise<{ value: T; model: string }> {
  const res = await client.beta.messages.create({
    model: llm.model,
    max_tokens: llm.max_tokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: llm.effort, format: zodOutputFormat(schema) },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  });
  if (res.stop_reason === 'refusal') throw new Error(`Model declined the request: ${res.stop_details?.explanation ?? 'no explanation given'}`);
  if (res.stop_reason === 'max_tokens') throw new Error('Output was cut off; raise llm.max_tokens in profile.yaml');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { value: schema.parse(JSON.parse(text)), model: res.model };
}

export async function rateJob(client: Anthropic, job: Job, profile: Profile, contact: Contact | undefined, llm: LlmConfig): Promise<LlmRating> {
  const { value, model } = await structured({
    client,
    llm,
    system: systemPrompt(profile, contact),
    user: `Rate this posting for the candidate. Be strict: a 70+ means you would expect an interview.\n\n${jobBlock(job)}`,
    schema: RatingSchema,
  });
  return { fit: Math.round(value.fit), rationale: value.rationale, concerns: value.concerns, model, ratedAt: new Date().toISOString() };
}

export function tailorPrompt(job: Job, questions: string[]): string {
  return `Write the application packet for this posting.\n\nScreening questions to answer:\n${questions.map((q) => `- ${q}`).join('\n')}\n\n${jobBlock(job)}`;
}

export async function tailorJob(client: Anthropic, job: Job, profile: Profile, contact: Contact | undefined, llm: LlmConfig, questions: string[] = STANDARD_QUESTIONS): Promise<Packet> {
  const { value, model } = await structured({
    client,
    llm,
    system: systemPrompt(profile, contact),
    user: tailorPrompt(job, questions),
    schema: PacketSchema,
  });
  return packetFromValue(job, value, model);
}

export function packetFromValue(job: Job, value: z.infer<typeof PacketSchema>, model: string): Packet {
  return {
    jobId: job.id,
    company: job.company,
    title: job.title,
    subject: value.subject,
    coverLetter: value.cover_letter,
    whyMe: value.why_me,
    answers: Object.fromEntries(value.answers.map((a) => [a.question, a.answer])),
    generatedAt: new Date().toISOString(),
    model,
  };
}

const AnswerSchema = z.object({
  answer: z.string().describe('The answer to paste into the form; for a multiple-choice question, exactly one of the offered options, verbatim'),
  confident: z.boolean().describe('false when the dossier does not contain enough to answer truthfully'),
});

/** Answer one unexpected form question from the dossier; returns undefined when it cannot be answered truthfully. */
export async function answerQuestion(client: Anthropic, job: Job, profile: Profile, contact: Contact | undefined, llm: LlmConfig, question: string, options?: string[]): Promise<string | undefined> {
  const user = [
    `An application form for the posting below asks: "${question}"`,
    options?.length ? `Options (answer with exactly one, verbatim): ${options.map((o) => JSON.stringify(o)).join(', ')}` : 'Free-text answer, under 120 words.',
    'Answer only from the dossier. If the dossier does not say, set confident to false.',
    '',
    jobBlock(job),
  ].join('\n');
  const { value } = await structured({ client, llm: { ...llm, effort: 'medium' }, system: systemPrompt(profile, contact), user, schema: AnswerSchema });
  if (!value.confident) return undefined;
  if (options?.length && !options.includes(value.answer)) {
    const match = options.find((o) => o.toLowerCase() === value.answer.toLowerCase());
    return match;
  }
  return value.answer;
}

/** Message Batches: half price, results within hours. Used for bulk tailoring. */
export async function submitTailorBatch(client: Anthropic, jobs: Job[], profile: Profile, contact: Contact | undefined, llm: LlmConfig): Promise<string> {
  const system = systemPrompt(profile, contact);
  const batch = await client.messages.batches.create({
    requests: jobs.map((job) => ({
      custom_id: job.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
      params: {
        model: llm.model,
        max_tokens: llm.max_tokens,
        output_config: { effort: llm.effort, format: zodOutputFormat(PacketSchema) },
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: tailorPrompt(job, STANDARD_QUESTIONS) }],
      },
    })),
  });
  return batch.id;
}

export function batchCustomId(jobId: string): string {
  return jobId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

export interface BatchOutcome {
  status: 'pending' | 'ended';
  packets: Packet[];
  failed: Array<{ jobId: string; error: string }>;
}

export async function collectTailorBatch(client: Anthropic, batchId: string, jobs: Job[]): Promise<BatchOutcome> {
  const batch = await client.messages.batches.retrieve(batchId);
  if (batch.processing_status !== 'ended') return { status: 'pending', packets: [], failed: [] };
  const byCustomId = new Map(jobs.map((j) => [batchCustomId(j.id), j]));
  const packets: Packet[] = [];
  const failed: BatchOutcome['failed'] = [];
  for await (const result of await client.messages.batches.results(batchId)) {
    const job = byCustomId.get(result.custom_id);
    if (!job) continue;
    if (result.result.type === 'succeeded') {
      const msg = result.result.message;
      if (msg.stop_reason === 'refusal') {
        failed.push({ jobId: job.id, error: 'declined' });
        continue;
      }
      const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      try {
        packets.push(packetFromValue(job, PacketSchema.parse(JSON.parse(text)), msg.model));
      } catch (err) {
        failed.push({ jobId: job.id, error: `unparseable output: ${(err as Error).message}` });
      }
    } else {
      failed.push({ jobId: job.id, error: result.result.type });
    }
  }
  return { status: 'ended', packets, failed };
}
