import type { Contact, Profile } from '../config.js';
import { normalizeKey } from '../text.js';
import type { Packet } from '../types.js';

export type FieldIntent =
  | 'first_name'
  | 'last_name'
  | 'full_name'
  | 'email'
  | 'phone'
  | 'linkedin'
  | 'website'
  | 'location'
  | 'resume'
  | 'cover_letter'
  | 'salary'
  | 'how_heard'
  | 'authorization'
  | 'sponsorship'
  | 'notice'
  | 'remote_ok'
  | 'timezone'
  | 'years_experience'
  | 'pronouns'
  | 'eeo'
  | 'consent'
  | 'unknown';

const RULES: Array<[FieldIntent, RegExp]> = [
  ['first_name', /\b(first|given|preferred)\s*name\b|^first$|\bnombre(?!\s*completo)\b/i],
  ['last_name', /\b(last|family|sur)\s*name\b|\bsurname\b|\bapellidos?\b/i],
  ['full_name', /\bfull\s*name\b|^name$|\byour name\b|\bnombre completo\b|\blegal name\b/i],
  ['email', /\be-?mail\b|\bcorreo\b/i],
  ['phone', /\bphone\b|\bmobile\b|\btel[eé]fono\b|\bcell\b|\bcelular\b/i],
  ['linkedin', /linkedin/i],
  ['website', /\bwebsite\b|\bportfolio\b|\bpersonal (site|url)\b|\bgithub\b|\bblog\b/i],
  ['resume', /\bresume\b|\br[eé]sum[eé]\b|\bcv\b|\bcurr[ií]cul/i],
  ['cover_letter', /\bcover\s*letter\b|\bcarta\b|\bmotivation\b|\bwhy (do you want|are you interested)\b/i],
  ['salary', /\bsalary\b|\bcompensation\b|\b(hourly|daily|day|hour) rate\b|\brate expectation|\bexpectations?\b.*\b(pay|salary|comp)|\bsueldo\b|\bsalario\b/i],
  ['how_heard', /\bhow did you (hear|find|learn)\b|\bwhere did you (hear|find)\b|\breferr?al source\b|\bsource of (this )?application\b/i],
  ['sponsorship', /\bsponsorship\b|\bvisa\b/i],
  ['authorization', /\bauthori[sz]ed to work\b|\bwork authori[sz]ation\b|\blegally (eligible|able|authori[sz]ed|permitted)\b|\bright to work\b|\bwork permit\b|\beligible to work\b/i],
  ['notice', /\bnotice period\b|\bstart date\b|\bavailability\b|\bwhen (can|could) you start\b|\bearliest\b|\bavailable to start\b/i],
  ['timezone', /\btime ?zones?\b|\butc\b|\bgmt\b/i],
  ['remote_ok', /\bwork remotely\b|\bremote work\b|\bcomfortable working remote/i],
  ['years_experience', /\byears? of (relevant |professional |work )?experience\b|\bhow many years\b/i],
  ['pronouns', /\bpronouns?\b/i],
  ['eeo', /\bgender\b|\brace\b|\bethnicit|\bveteran\b|\bdisabilit|\bsexual orientation\b|\bself[- ]identif|\bhispanic\b|\blatino\b|\bdemographic\b|\btransgender\b|\bequal employment\b|\beeo\b/i],
  ['consent', /\bconsent\b|\bprivacy\b|\bgdpr\b|\bi agree\b|\backnowledge\b|\bterms\b|\bpolicy\b|\bcertify\b|\bauthorize .*process/i],
  ['location', /\b(current )?location\b|\bcity\b|\bwhere (are you|do you) (based|live|located)\b|\bcountry\b|\bciudad\b|\bubicaci[oó]n\b|\baddress\b/i],
];

export interface FieldMeta {
  name?: string;
  type?: string;
  placeholder?: string;
}

export function classifyField(label: string, meta: FieldMeta = {}): FieldIntent {
  const text = `${label} ${meta.name ?? ''} ${meta.placeholder ?? ''}`.trim();
  if (meta.type === 'file') return /cover|carta|letter/i.test(text) ? 'cover_letter' : 'resume';
  if (meta.type === 'email') return 'email';
  if (meta.type === 'tel') return 'phone';
  for (const [intent, re] of RULES) if (re.test(text)) return intent;
  return 'unknown';
}

export interface ValueContext {
  contact: Contact;
  profile: Profile;
  packet?: Packet;
}

/** Text to type for a known field, or undefined when the field should be left alone. */
export function valueFor(intent: FieldIntent, ctx: ValueContext): string | undefined {
  const { contact, profile, packet } = ctx;
  const a = profile.apply.answers;
  switch (intent) {
    case 'first_name':
      return contact.first_name;
    case 'last_name':
      return contact.last_name;
    case 'full_name':
      return `${contact.first_name} ${contact.last_name}`;
    case 'email':
      return contact.email;
    case 'phone':
      return contact.phone;
    case 'linkedin':
      return contact.linkedin;
    case 'website':
      return contact.website || contact.linkedin;
    case 'location':
      return `${contact.city}, ${contact.country}`;
    case 'cover_letter':
      return packet?.coverLetter;
    case 'salary':
      return a.salary_expectation;
    case 'how_heard':
      return a.how_did_you_hear ?? 'Job board';
    case 'authorization':
      return a.work_authorization;
    case 'sponsorship':
      return a.require_sponsorship;
    case 'notice':
      return a.notice_period;
    case 'remote_ok':
      return a.remote_preference ?? 'Remote';
    case 'timezone':
      return profile.candidate.timezone;
    case 'years_experience':
      return a.years_experience ?? '10+';
    case 'pronouns':
      return a.pronouns || undefined;
    default:
      return undefined;
  }
}

function findOption(options: string[], re: RegExp): string | undefined {
  return options.find((o) => re.test(o));
}

/** Pick one of a select's or radio group's options for a known intent. */
export function pickOption(intent: FieldIntent, options: string[], ctx: ValueContext, label = ''): string | undefined {
  const a = ctx.profile.apply.answers;
  const clean = options.filter((o) => o && !/^(select|choose|please select|--|—)/i.test(o.trim()));
  if (clean.length === 0) return undefined;
  switch (intent) {
    case 'eeo':
    case 'pronouns':
      return findOption(clean, /decline|prefer not|don'?t wish|do not wish|rather not|not to (say|answer|disclose)/i);
    case 'how_heard':
      return findOption(clean, /job board|other|online|linkedin|internet|website/i) ?? clean[clean.length - 1];
    case 'authorization': {
      const yes = /mexico|méxico/i.test(label) ? 'Yes' : (a.work_authorization_yes_no ?? 'No');
      return findOption(clean, yes === 'Yes' ? /^yes\b/i : /^no\b/i);
    }
    case 'sponsorship': {
      const yes = a.require_sponsorship_yes_no ?? 'Yes';
      return findOption(clean, yes === 'Yes' ? /^yes\b/i : /^no\b/i);
    }
    case 'remote_ok':
      return findOption(clean, /^yes\b|remote/i);
    case 'timezone':
      return findOption(clean, /central|\bcst\b|utc-?6|gmt-?6|mexico|americas/i);
    case 'notice':
      return findOption(clean, /immediately|asap|right away|2 weeks|two weeks|less than (a|1) month|within a month/i);
    case 'location':
      return findOption(clean, /mexico/i) ?? findOption(clean, /latin america|latam|americas|other|international|outside/i);
    case 'years_experience':
      return findOption(clean, /10\+|10 ?- ?15|more than 10|over 10|\b1[0-9]\b|\b2[0-9]\b|10\+ years/i) ?? findOption(clean, /\b[5-9]\b\+?|5 ?- ?10|more than 5/i);
    case 'consent':
      return findOption(clean, /^yes\b|agree|accept|i consent/i);
    default:
      return undefined;
  }
}

const STOPWORDS = new Set(['describe', 'your', 'you', 'what', 'with', 'have', 'has', 'the', 'and', 'are', 'how', 'many', 'tell', 'about', 'please', 'this', 'that', 'for', 'can', 'could', 'would', 'will', 'any', 'our', 'who', 'why', 'when', 'where', 'which', 'into', 'from', 'does', 'did', 'role', 'position', 'company', 'job', 'us', 'in', 'or', 'to', 'of', 'is', 'it', 'be', 'an', 'on', 'at', 'by', 'do', 'we', 'my', 'if', 'as', 'so', 'no', 'a']);

function tokens(s: string): Set<string> {
  return new Set(normalizeKey(s).split(' ').filter((w) => w.length >= 2 && !STOPWORDS.has(w)));
}

/** Answer from the approved Q&A bank when the question is close enough (word overlap). */
export function bankAnswer(question: string, profile: Profile): string | undefined {
  const q = tokens(question);
  if (q.size === 0) return undefined;
  let best: { score: number; a: string } | undefined;
  for (const qa of profile.qa_bank) {
    const t = tokens(qa.q);
    let inter = 0;
    for (const w of q) if (t.has(w)) inter++;
    const score = inter / Math.max(1, Math.min(q.size, t.size));
    if (inter >= Math.min(2, q.size, t.size) && score >= 0.5 && (!best || score > best.score)) best = { score, a: qa.a };
  }
  return best?.a;
}
