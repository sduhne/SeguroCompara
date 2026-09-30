# Phoenix

Remote job search pipeline for roles paid in USD or EUR: employee, part-time, or service provider. It discovers listings from public job APIs and company boards, scores them against a candidate profile, has Claude write a tailored cover letter and screening answers for each shortlisted job, fills application forms in a browser, and keeps a log of everything.

It deliberately does **not** touch LinkedIn: LinkedIn prohibits automated applications and restricts accounts that try. The LinkedIn profile is for inbound; Phoenix works the company boards directly.

## Setup

```bash
cd phoenix
npm install
npx playwright install chromium        # once, for the apply step
npx tsx src/cli.ts init                # creates private/contact.yaml from the example
```

Then:

1. Fill in `private/contact.yaml` (email, phone, LinkedIn URL) and put the CV in `private/`, matching `cv_path`. That folder is git-ignored; this repository is public.
2. Review `profile.yaml`. Every line marked `SET ME` is a placeholder: salary expectations, the standard yes/no answers about work authorization and sponsorship, the Menlo Capital dates.
3. Export `ANTHROPIC_API_KEY` for the Claude steps (score `--llm`, tailor, and unknown form questions during apply).

Node 22 or later. No database: the state lives in `data/` as JSON (git-ignored).

## Daily loop

```bash
npx tsx src/cli.ts discover              # pull, filter, score, store
npx tsx src/cli.ts score --llm -n 40     # Claude rates the shortlist (fit 0-100 + concerns)
npx tsx src/cli.ts list                  # best first
npx tsx src/cli.ts tailor -n 15          # cover letter + answers per job -> data/packets/*.md
npx tsx src/cli.ts apply -n 15           # DRY RUN: fills forms, screenshots, submits nothing
npx tsx src/cli.ts apply -n 15 --confirm # submits, within the daily cap
npx tsx src/cli.ts report                # data/report.md
```

`npm run daily` chains discover, score, tailor, apply (dry run) and report.

Other commands: `show <id>`, `status <id> <status> [note]` (interview, offer, rejected, skipped), `tailor --batch` and `tailor --collect <batchId>` (Message Batches, half price, results within hours), `apply --headed` (visible browser, needed when a captcha appears), `discover --fixture test/fixtures/sample-jobs.json` (offline demo).

## How it decides

**Sources** (`src/sources/`): Remotive, RemoteOK, Jobicy, Himalayas, Arbeitnow, We Work Remotely (RSS), Working Nomads, the monthly Hacker News "Who is hiring?" thread, and the public boards of the companies listed under `boards:` in `profile.yaml` on Greenhouse, Lever and Ashby. Unknown board tokens are skipped with a log line, so add companies freely.

**Hard filters** (`src/score.ts`): not remote, junior titles, engineering/support/sales titles, postings older than `max_age_days`, blocked companies.

**Score 0-100**: best title-pattern match (up to 35), keyword coverage (25), senior title (8), region (+8 good, -20 "US only"-style), currency (+10 USD/EUR, +5 GBP/CHF/CAD, -10 only a weak currency), pay level, engagement type, freshness, minus penalties for on-site/hybrid wording, residence requirements and fluent-language requirements. `min_score` shortlists; `store_floor` decides what is even stored.

**Claude** (`src/llm.ts`): Opus 5.5 with structured outputs, high effort, prompt caching on the candidate dossier, and the server-side refusal fallback enabled. The dossier is built from `profile.yaml` only, and the prompt forbids inventing facts. Ratings blend into the ranking (60% Claude fit, 40% rule score).

**Apply** (`src/apply/`): Playwright opens the board's own form, labels every field, and fills what it recognises: name, email, phone, LinkedIn, location, CV upload, cover letter, salary, how-you-heard, authorization, sponsorship, notice period; demographic questions get "Decline to self-identify"; consent boxes are ticked. Unknown questions are answered from `qa_bank` when close enough, else by Claude from the dossier, else left blank and the job is queued for you. Postings that take email get a `.eml` draft in `data/outbox/`. Anything else (Workable, LinkedIn Easy Apply, bespoke portals) is queued with its packet.

**Safety rails**: dry run unless `--confirm`; `daily_cap` submissions per day; one application per company per `per_company_cooldown_days`; never submits with a required field unanswered; never submits past a captcha (rerun with `--headed` and solve it); every attempt logged in `data/applications.json` with a screenshot.

## Honesty settings

Two answers matter legally. `work_authorization_yes_no` is the answer to "Are you authorized to work in <the company's country>?" and defaults to `No` (it answers `Yes` when the question names Mexico). `require_sponsorship_yes_no` defaults to `Yes`. For contractor roles these questions often do not apply, and the free-text `work_authorization` answer explains the contractor/EOR setup. Change the defaults only if they are true for you.

## Running inside a Claude Code cloud session

The environment's network policy must allow these hosts, or `discover` returns nothing: `remotive.com`, `remoteok.com`, `jobicy.com`, `himalayas.app`, `www.arbeitnow.com`, `weworkremotely.com`, `www.workingnomads.com`, `hn.algolia.com`, `boards-api.greenhouse.io`, `api.lever.co`, `api.ashbyhq.com`, plus `boards.greenhouse.io`, `job-boards.greenhouse.io`, `jobs.lever.co`, `jobs.ashbyhq.com` for the apply step. Node's built-in `fetch` ignores the session proxy unless you run with `NODE_USE_ENV_PROXY=1`.

## Tests

```bash
npm test          # vitest: parsers, scoring, store, form classifier, offline discovery
npm run typecheck
```
