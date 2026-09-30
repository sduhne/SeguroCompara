import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { applyWithBrowser } from '../src/apply/browser.js';
import { loadConfig, packageRoot, type Contact } from '../src/config.js';
import { Store } from '../src/store.js';
import type { Job, Packet } from '../src/types.js';

// Needs a Chromium: run with PHOENIX_BROWSER_TESTS=1 (and PHOENIX_CHROMIUM_PATH if Playwright's own download is missing).
const enabled = process.env.PHOENIX_BROWSER_TESTS === '1';

const FORM = `<!doctype html><html><body>
<h1>Director of AI Strategy</h1>
<form id="app">
  <div><label for="first_name">First Name *</label><input id="first_name" name="first_name" required></div>
  <div><label for="last_name">Last Name *</label><input id="last_name" name="last_name" required></div>
  <div><label for="email">Email *</label><input id="email" type="email" name="email" required></div>
  <div><label for="phone">Phone</label><input id="phone" type="tel" name="phone"></div>
  <div><label for="resume">Resume/CV *</label><input id="resume" type="file" name="resume" required></div>
  <div><label for="cover">Cover Letter</label><textarea id="cover" name="cover_letter"></textarea></div>
  <div><label for="linkedin">LinkedIn Profile</label><input id="linkedin" name="urls[LinkedIn]"></div>
  <div><label for="heard">How did you hear about this job?</label>
    <select id="heard" name="heard"><option>Select...</option><option>Referral</option><option>Job board</option><option>Other</option></select></div>
  <fieldset><legend>Are you legally authorized to work in the United States? *</legend>
    <label><input type="radio" name="auth" value="1"> Yes</label>
    <label><input type="radio" name="auth" value="0"> No</label></fieldset>
  <div><label for="gender">Gender</label>
    <select id="gender" name="gender"><option>Select...</option><option>Male</option><option>Female</option><option>Decline to self-identify</option></select></div>
  <div><label for="tz">What time zone are you in? *</label><input id="tz" name="tz" required></div>
  <div><label for="proud">Describe a project you are proud of</label><textarea id="proud" name="proud"></textarea></div>
  <div><label><input type="checkbox" id="consent" name="consent"> I consent to the processing of my personal data</label></div>
  <button type="submit">Submit application</button>
</form>
<script>
  document.getElementById('app').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const filled = ['first_name','last_name','email','tz'].every((n) => f.elements[n].value.trim());
    document.body.innerHTML = filled ? '<h1>Thank you for applying!</h1>' : '<p class="error">Missing fields</p>';
  });
</script>
</body></html>`;

describe.skipIf(!enabled)('applyWithBrowser against a local form', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'phoenix-browser-'));
    dirs.push(dir);
    const formPath = join(dir, 'form.html');
    writeFileSync(formPath, FORM);
    const cvPath = join(dir, 'cv.pdf');
    writeFileSync(cvPath, '%PDF-1.4 test');
    const { profile } = loadConfig({ root: packageRoot() });
    const contact: Contact = { first_name: 'Santiago', last_name: 'Duhne Ayala', email: 's@example.com', phone: '+52 55 0000 0000', linkedin: 'https://www.linkedin.com/in/x', city: 'Mexico City', country: 'Mexico', cv_path: cvPath };
    const store = new Store(join(dir, 'data'));
    const url = pathToFileURL(formPath).href;
    const job: Job = { id: 'local:1', source: 'local', externalId: '1', title: 'Director of AI Strategy', company: 'Northwind', url, applyUrl: url, description: '', remote: true, tags: [], ats: 'greenhouse', firstSeenAt: '', lastSeenAt: '', status: 'tailored' };
    const packet: Packet = { jobId: 'local:1', company: 'Northwind', title: 'Director of AI Strategy', subject: 'Application: Director of AI Strategy', coverLetter: 'Dear Northwind team, this is the cover letter.', whyMe: [], answers: {}, generatedAt: '', model: 'test' };
    return { profile, contact, store, job, packet, cvPath };
  }

  it('fills every recognised field in a dry run, then submits with confirm', async () => {
    const s = setup();
    const dry = await applyWithBrowser({ ...s, options: { confirm: false, headed: false } });
    expect(dry.status).toBe('dry_run');
    expect(dry.unanswered).toEqual([]);
    const filled = dry.filled.join('\n').toLowerCase();
    for (const needle of ['first name', 'last name', 'email', 'resume', 'cover letter', 'linkedin', 'job board', 'authorized', '← no', 'decline to self-identify', 'time zone', 'checked']) expect(filled).toContain(needle);
    expect(dry.screenshot && existsSync(dry.screenshot)).toBe(true);

    const real = await applyWithBrowser({ ...s, options: { confirm: true, headed: false } });
    expect(real.status).toBe('submitted');
  }, 90_000);
});
