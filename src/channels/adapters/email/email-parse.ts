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
