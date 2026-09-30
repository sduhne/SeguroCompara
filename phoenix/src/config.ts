import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { z } from 'zod';

const TitlePattern = z.object({ pattern: z.string(), weight: z.number() });

const Experience = z.object({
  company: z.string(),
  title: z.string(),
  period: z.string(),
  summary: z.string().optional(),
  bullets: z.array(z.string()).default([]),
});

export const SearchSchema = z.object({
  queries: z.array(z.string()).default([]),
  titles: z.array(TitlePattern).default([]),
  negative_titles: z.array(z.string()).default([]),
  junior_words: z.array(z.string()).default([]),
  senior_words: z.array(z.string()).default([]),
  keywords_strong: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  negative_keywords: z.array(z.string()).default([]),
  currencies_preferred: z.array(z.string()).default(['USD', 'EUR']),
  currencies_ok: z.array(z.string()).default([]),
  regions_good: z.array(z.string()).default([]),
  regions_bad: z.array(z.string()).default([]),
  min_score: z.number().default(55),
  store_floor: z.number().default(25),
  max_age_days: z.number().default(45),
  min_annual_usd: z.number().optional(),
  blocked_companies: z.array(z.string()).default([]),
});

export const ProfileSchema = z.object({
  candidate: z.object({
    name: z.string(),
    headline: z.string(),
    location: z.string(),
    country: z.string(),
    timezone: z.string(),
    languages: z.array(z.string()).default([]),
    summary: z.string(),
    experience: z.array(Experience).default([]),
    education: z.array(z.string()).default([]),
    skills: z.array(z.string()).default([]),
    work_authorization: z.string(),
    availability: z.string(),
    engagement_types: z.array(z.string()).default([]),
    compensation: z.object({
      full_time_usd_year_min: z.number(),
      part_time_usd_hour_min: z.number(),
      consulting_usd_day_min: z.number(),
    }),
  }),
  search: SearchSchema,
  sources: z.record(z.string(), z.boolean()).default({}),
  boards: z.object({
    greenhouse: z.array(z.string()).default([]),
    lever: z.array(z.string()).default([]),
    ashby: z.array(z.string()).default([]),
    wwr_feeds: z.array(z.string()).default([]),
  }),
  apply: z.object({
    daily_cap: z.number().default(25),
    per_company_cooldown_days: z.number().default(60),
    headed: z.boolean().default(false),
    answers: z.record(z.string(), z.string()).default({}),
  }),
  qa_bank: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
  llm: z.object({
    model: z.string().default('claude-opus-5-5'),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),
    max_tokens: z.number().default(8000),
  }),
});

export const ContactSchema = z.object({
  first_name: z.string(),
  last_name: z.string(),
  email: z.string(),
  phone: z.string(),
  linkedin: z.string().optional(),
  website: z.string().optional(),
  city: z.string(),
  country: z.string(),
  cv_path: z.string(),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type Search = z.infer<typeof SearchSchema>;
export type Contact = z.infer<typeof ContactSchema>;
export type LlmConfig = Profile['llm'];

export interface Config {
  root: string;
  dataDir: string;
  profile: Profile;
  contact?: Contact;
  /** Absolute path of the CV, when contact.yaml names one that exists. */
  cvPath?: string;
}

export function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

function readYaml(path: string): unknown {
  return YAML.parse(readFileSync(path, 'utf8'));
}

export function loadConfig(opts: { root?: string; dataDir?: string } = {}): Config {
  const root = resolve(opts.root ?? process.env.PHOENIX_ROOT ?? packageRoot());
  const profilePath = join(root, 'profile.yaml');
  if (!existsSync(profilePath)) throw new Error(`No profile.yaml at ${root}`);
  const parsedProfile = ProfileSchema.safeParse(readYaml(profilePath));
  if (!parsedProfile.success) throw new Error(`profile.yaml is invalid:\n${z.prettifyError(parsedProfile.error)}`);
  const profile = parsedProfile.data;

  let contact: Contact | undefined;
  let cvPath: string | undefined;
  const contactPath = join(root, 'private', 'contact.yaml');
  if (existsSync(contactPath)) {
    const parsedContact = ContactSchema.safeParse(readYaml(contactPath));
    if (!parsedContact.success) throw new Error(`private/contact.yaml is invalid:\n${z.prettifyError(parsedContact.error)}`);
    contact = parsedContact.data;
    const cv = isAbsolute(contact.cv_path) ? contact.cv_path : join(root, contact.cv_path);
    if (existsSync(cv)) cvPath = cv;
  }

  const dataDir = resolve(opts.dataDir ?? process.env.PHOENIX_DATA_DIR ?? join(root, 'data'));
  return { root, dataDir, profile, contact, cvPath };
}
