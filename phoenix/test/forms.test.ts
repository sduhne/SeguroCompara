import { describe, expect, it } from 'vitest';
import { bankAnswer, classifyField, detectRegion, pickOption, valueFor } from '../src/apply/forms.js';
import { loadConfig, packageRoot } from '../src/config.js';
import type { Contact } from '../src/config.js';

const { profile } = loadConfig({ root: packageRoot() });
const contact: Contact = { first_name: 'Santiago', last_name: 'Duhne Ayala', email: 's@example.com', phone: '+52 55 0000 0000', linkedin: 'https://www.linkedin.com/in/x', city: 'Mexico City', country: 'Mexico', cv_path: 'private/cv.pdf' };
const ctx = { contact, profile };

describe('classifyField', () => {
  it('recognises the standard fields', () => {
    expect(classifyField('First Name *')).toBe('first_name');
    expect(classifyField('Last name')).toBe('last_name');
    expect(classifyField('Email', { type: 'email' })).toBe('email');
    expect(classifyField('Phone', { type: 'tel' })).toBe('phone');
    expect(classifyField('LinkedIn Profile')).toBe('linkedin');
    expect(classifyField('Resume/CV', { type: 'file' })).toBe('resume');
    expect(classifyField('Cover Letter', { type: 'file' })).toBe('cover_letter');
    expect(classifyField('Cover Letter')).toBe('cover_letter');
    expect(classifyField('How did you hear about this job?')).toBe('how_heard');
    expect(classifyField('Are you legally authorized to work in the United States?')).toBe('authorization');
    expect(classifyField('Will you now or in the future require sponsorship?')).toBe('sponsorship');
    expect(classifyField('What are your salary expectations?')).toBe('salary');
    expect(classifyField('Gender')).toBe('eeo');
    expect(classifyField('I consent to the processing of my data')).toBe('consent');
    expect(classifyField('Current location')).toBe('location');
    expect(classifyField('Describe a project you are proud of')).toBe('unknown');
  });
});

describe('valueFor and pickOption', () => {
  it('fills contact details from contact.yaml', () => {
    expect(valueFor('first_name', ctx)).toBe('Santiago');
    expect(valueFor('location', ctx)).toBe('Mexico City, Mexico');
    expect(valueFor('years_experience', ctx)).toBe('10+');
  });
  it('declines demographic questions and answers authorization honestly', () => {
    expect(pickOption('eeo', ['Male', 'Female', 'Decline to self-identify'], ctx)).toBe('Decline to self-identify');
    expect(pickOption('authorization', ['Yes', 'No'], ctx, 'Are you authorized to work in the United States?')).toBe('No');
    expect(pickOption('authorization', ['Yes', 'No'], ctx, 'Are you authorized to work in Mexico?')).toBe('Yes');
    expect(pickOption('sponsorship', ['Yes', 'No'], ctx)).toBe('Yes');
    expect(pickOption('authorization', ['Yes', 'No'], ctx, 'Are you eligible to work in Germany?')).toBe('Yes');
    expect(pickOption('authorization', ['Yes', 'No'], ctx, 'Do you have the right to work in the EU?')).toBe('Yes');
    expect(pickOption('authorization', ['Yes', 'No'], ctx, 'Are you authorised to work in the UK?')).toBe('No');
    expect(pickOption('sponsorship', ['Yes', 'No'], ctx, 'Will you require visa sponsorship to work in the Netherlands?')).toBe('No');
    expect(pickOption('sponsorship', ['Yes', 'No'], { ...ctx, region: 'eu' })).toBe('No');
    expect(pickOption('authorization', ['Yes', 'No'], { ...ctx, region: 'us' }, 'Are you legally authorized to work in the country of this job?')).toBe('No');
    expect(pickOption('how_heard', ['Select...', 'Referral', 'Job board', 'Other'], ctx)).toBe('Job board');
  });
});

describe('detectRegion', () => {
  it('reads the hiring region from a location line', () => {
    expect(detectRegion('Remote - EU')).toBe('eu');
    expect(detectRegion('Berlin, Germany (remote)')).toBe('eu');
    expect(detectRegion('Remote - US')).toBe('us');
    expect(detectRegion('Remote - Worldwide')).toBe('other');
    expect(detectRegion('Tell us where you are based')).toBe('other');
  });
});

describe('bankAnswer', () => {
  it('matches a close paraphrase of a bank question', () => {
    expect(bankAnswer('What time zone are you in?', profile)).toContain('Central Time');
  });
  it('returns nothing for an unrelated question', () => {
    expect(bankAnswer('Describe your favourite database', profile)).toBeUndefined();
  });
});
