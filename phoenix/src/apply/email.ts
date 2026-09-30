import { basename, extname } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Contact } from '../config.js';
import type { Store } from '../store.js';
import type { Job, Packet } from '../types.js';

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.txt': 'text/plain',
};

function wrap76(b64: string): string {
  return b64.replace(/(.{76})/g, '$1\r\n');
}

export function buildEml(args: { from: string; to: string; subject: string; body: string; attachmentPath?: string }): string {
  const boundary = `phoenix-${Date.now().toString(36)}`;
  const head = [
    `From: ${args.from}`,
    `To: ${args.to}`,
    `Subject: ${args.subject}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(args.body, 'utf8').toString('base64')),
  ];
  if (args.attachmentPath) {
    const name = basename(args.attachmentPath);
    const type = MIME[extname(name).toLowerCase()] ?? 'application/octet-stream';
    head.push(
      `--${boundary}`,
      `Content-Type: ${type}; name="${name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${name}"`,
      '',
      wrap76(readFileSync(args.attachmentPath).toString('base64')),
    );
  }
  head.push(`--${boundary}--`, '');
  return head.join('\r\n');
}

export function mailtoLink(to: string, subject: string, body: string): string {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Write a ready-to-send .eml (drag into Gmail or Apple Mail) plus a mailto link for the same message. */
export function writeEmailDraft(store: Store, job: Job, packet: Packet, contact: Contact, cvPath?: string): { path: string; mailto: string } {
  const to = job.applyEmail ?? job.applyUrl?.replace(/^mailto:/, '') ?? '';
  if (!to) throw new Error(`Job ${job.id} has no application email`);
  const from = `${contact.first_name} ${contact.last_name} <${contact.email}>`;
  const body = `${packet.coverLetter}\n\n${contact.first_name} ${contact.last_name}\n${contact.email} · ${contact.phone}${contact.linkedin ? `\n${contact.linkedin}` : ''}\n`;
  const eml = buildEml({ from, to, subject: packet.subject, body, attachmentPath: cvPath });
  const path = join(store.outboxDir, `${job.id.replace(/[^a-z0-9_-]+/gi, '_')}.eml`);
  writeFileSync(path, eml);
  return { path, mailto: mailtoLink(to, packet.subject, body) };
}
