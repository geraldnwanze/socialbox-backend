import sanitizeHtml from 'sanitize-html';
import type { ParsedMail } from 'mailparser';

/** Pure helpers for turning raw mail into inbox-friendly pieces. */

/** "Re: Re: Hello" -> "Hello", so replies never stack up prefixes. */
export function baseSubject(subject?: string | null): string {
  return (subject ?? '').replace(/^(\s*(re|fwd?|aw|sv)\s*:\s*)+/i, '').trim();
}

export function replySubject(subject?: string | null): string {
  const base = baseSubject(subject);
  return base ? `Re: ${base}` : 'Re: your message';
}

const QUOTE_HEADERS = [
  /^on .{5,200} wrote:\s*$/i,
  /^le .{5,200} a écrit\s*:\s*$/i,
  /^-{2,}\s*original message\s*-{2,}\s*$/i,
  /^-{2,}\s*forwarded message\s*-{2,}\s*$/i,
  /^_{5,}\s*$/,
  /^from:\s.+@.+/i,
];

/**
 * Drops the quoted history a mail client appends to a reply so the thread shows only the new
 * text. Conservative: if nothing precedes the quote marker, the original text is kept whole.
 */
export function stripQuotedReply(body: string): string {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const wrapsOnNextLine =
      /^on .{5,200}$/i.test(line) && /wrote:\s*$/i.test(lines[i + 1] ?? '');
    if (
      QUOTE_HEADERS.some((re) => re.test(line)) ||
      wrapsOnNextLine ||
      (line.startsWith('>') && i > 0)
    ) {
      cut = i;
      break;
    }
  }
  const stripped = lines.slice(0, cut).join('\n').trim();
  return stripped || body.trim();
}

/** Crude HTML -> text for mail that has no plain-text part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface MailHeaders {
  get(name: string): unknown;
}

/**
 * Mail no human wrote: auto-replies, bulk/list mail, delivery failures. Importing these would
 * clutter the inbox, and answering them can start mail loops.
 */
export function isAutomatedMail(
  headers: MailHeaders,
  fromAddress: string,
): boolean {
  const autoSubmitted = String(headers.get('auto-submitted') ?? '')
    .trim()
    .toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return true;

  const precedence = String(headers.get('precedence') ?? '')
    .trim()
    .toLowerCase();
  if (['bulk', 'junk', 'list', 'auto_reply'].includes(precedence)) return true;

  if (headers.get('list-id') || headers.get('x-autoreply')) return true;
  if (String(headers.get('x-auto-response-suppress') ?? '').trim()) return true;

  return /^(mailer-daemon|postmaster)@/i.test(fromAddress);
}

/** "ann.lee@x.com" -> "Ann Lee" for contacts whose mail carries no display name. */
export function nameFromAddress(address: string): string {
  const local = address.split('@')[0] ?? address;
  const words = local.split(/[._-]+/).filter(Boolean);
  if (words.length === 0) return address;
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

const MAX_HTML_CHARS = 100_000;

/**
 * Makes a mail's HTML safe to show to agents: only basic formatting tags survive, no scripts,
 * styles, forms or images (remote images would tell the sender when and where mail was opened),
 * links are http(s)/mailto only and always open in a new tab. Quoted history is removed so the
 * formatted view shows the same new text as the plain one. Returns null when nothing is left or
 * it is too large to be worth storing.
 */
export function sanitizeEmailHtml(html: string): string | null {
  const clean = sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'div',
      'span',
      'b',
      'strong',
      'i',
      'em',
      'u',
      's',
      'a',
      'ul',
      'ol',
      'li',
      'pre',
      'code',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'hr',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
      }),
    },
    exclusiveFilter: (frame) =>
      frame.tag === 'blockquote' ||
      /gmail_quote|yahoo_quoted|moz-cite-prefix/.test(
        frame.attribs?.class ?? '',
      ),
  }).trim();
  if (!clean || clean.length > MAX_HTML_CHARS) return null;
  return clean;
}

export interface Bounce {
  /** Message-ID of the mail we sent that could not be delivered (with angle brackets). */
  messageId: string;
  reason: string;
}

/**
 * Recognizes a permanent delivery-failure report (RFC 3464 DSN, what every mail server sends when
 * it cannot deliver) and pulls out which of our mails failed and why. Delay notices ("still
 * trying") and anything unrecognizable return null — a failure is only reported when certain.
 */
export function parseBounce(mail: ParsedMail, source: Buffer): Bounce | null {
  const contentType = mail.headers.get('content-type') as
    { value?: string; params?: Record<string, string> } | undefined;
  if (
    contentType?.value !== 'multipart/report' ||
    contentType.params?.['report-type'] !== 'delivery-status'
  ) {
    return null;
  }

  const raw = source.toString('utf8');
  const action = /^Action:\s*(\w+)/im.exec(raw)?.[1]?.toLowerCase();
  const status = /^Status:\s*(\d\.\d+\.\d+)/im.exec(raw)?.[1];
  const permanent = action === 'failed' || (!action && status?.startsWith('5'));
  if (!permanent) return null;

  // Our original mail is returned (whole or just its headers) as an attachment.
  const original = mail.attachments.find((a) =>
    ['message/rfc822', 'text/rfc822-headers'].includes(a.contentType),
  );
  const messageId = original
    ? /^Message-ID:\s*(<[^>\r\n]+>)/im.exec(
        original.content.toString('utf8'),
      )?.[1]
    : undefined;
  if (!messageId) return null;

  // "Diagnostic-Code: smtp; 550 5.1.1 ..." may continue on indented lines.
  const diagnostic = /^Diagnostic-Code:\s*([^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*)/im
    .exec(raw)?.[1]
    ?.replace(/\r?\n[ \t]+/g, ' ')
    .replace(/^smtp;\s*/i, '');
  const reason = (
    diagnostic || (status ? `Delivery failed (${status})` : 'Delivery failed')
  )
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 300);
  return { messageId, reason };
}
