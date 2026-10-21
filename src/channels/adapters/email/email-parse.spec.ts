import {
  baseSubject,
  htmlToText,
  isAutomatedMail,
  nameFromAddress,
  replySubject,
  sanitizeEmailHtml,
  stripQuotedReply,
} from './email-parse';

const headers = (h: Record<string, string>) => ({
  get: (name: string) => h[name],
});

describe('subjects', () => {
  it('never stacks Re: prefixes', () => {
    expect(baseSubject('Re: RE: Fwd: Order 42')).toBe('Order 42');
    expect(replySubject('Re: Order 42')).toBe('Re: Order 42');
    expect(replySubject('Order 42')).toBe('Re: Order 42');
    expect(replySubject(undefined)).toBe('Re: your message');
  });
});

describe('stripQuotedReply', () => {
  it('keeps only the new text above an "On ... wrote:" quote', () => {
    const body =
      'Thanks, that works!\n\nOn Tue, 20 Oct 2026 at 10:00, Support <s@x.com> wrote:\n> Hello\n> there';
    expect(stripQuotedReply(body)).toBe('Thanks, that works!');
  });

  it('handles a header line wrapped onto two lines', () => {
    const body =
      'Yes please.\n\nOn Tue, 20 Oct 2026 at 10:00, Support Team <support@example.com>\nwrote:\n> hi';
    expect(stripQuotedReply(body)).toBe('Yes please.');
  });

  it('cuts at the first quoted ">" line and at Outlook separators', () => {
    expect(stripQuotedReply('Got it\n> old text')).toBe('Got it');
    expect(
      stripQuotedReply('Got it\n-----Original Message-----\nFrom: a@b.c'),
    ).toBe('Got it');
  });

  it('keeps the whole body when it is entirely quoted or has no quote', () => {
    expect(stripQuotedReply('> only quoted')).toBe('> only quoted');
    expect(stripQuotedReply('Just a plain message')).toBe(
      'Just a plain message',
    );
  });
});

describe('isAutomatedMail', () => {
  it('flags auto-replies, bulk mail, lists and bounces', () => {
    expect(
      isAutomatedMail(headers({ 'auto-submitted': 'auto-replied' }), 'a@b.c'),
    ).toBe(true);
    expect(isAutomatedMail(headers({ precedence: 'bulk' }), 'a@b.c')).toBe(
      true,
    );
    expect(isAutomatedMail(headers({ 'list-id': '<x.y>' }), 'a@b.c')).toBe(
      true,
    );
    expect(isAutomatedMail(headers({}), 'MAILER-DAEMON@mx.example.com')).toBe(
      true,
    );
  });

  it('lets normal human mail through', () => {
    expect(
      isAutomatedMail(headers({ 'auto-submitted': 'no' }), 'ann@x.com'),
    ).toBe(false);
    expect(isAutomatedMail(headers({}), 'ann@x.com')).toBe(false);
  });
});

describe('text helpers', () => {
  it('converts html to readable text', () => {
    expect(
      htmlToText(
        '<p>Hello&nbsp;<b>Ann</b></p><style>p{}</style><div>Bye</div>',
      ),
    ).toBe('Hello Ann\nBye');
  });

  it('builds a name from an address', () => {
    expect(nameFromAddress('ann.lee@x.com')).toBe('Ann Lee');
    expect(nameFromAddress('sales_team@x.com')).toBe('Sales Team');
  });
});

describe('sanitizeEmailHtml', () => {
  it('keeps basic formatting and drops scripts, styles, event handlers and images', () => {
    const out = sanitizeEmailHtml(
      '<p onclick="x()">Hi <b>Ann</b></p><script>alert(1)</script><style>p{}</style><img src="https://t.example/pixel.gif"><iframe src="https://evil"></iframe>',
    );
    expect(out).toBe('<p>Hi <b>Ann</b></p>');
  });

  it('allows only safe link schemes and opens links safely', () => {
    const out = sanitizeEmailHtml(
      '<a href="https://ok.example">ok</a><a href="javascript:alert(1)">bad</a><a href="data:text/html,x">bad2</a>',
    ) as string;
    expect(out).toContain('href="https://ok.example"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('target="_blank"');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('data:');
  });

  it('removes quoted history so it matches the plain-text view', () => {
    const out = sanitizeEmailHtml(
      '<div>Thanks!</div><div class="gmail_quote">On Tue, Ann wrote:<blockquote>old</blockquote></div>',
    );
    expect(out).toBe('<div>Thanks!</div>');
  });

  it('returns null when nothing remains or it is huge', () => {
    expect(sanitizeEmailHtml('<script>x</script>')).toBeNull();
    expect(sanitizeEmailHtml(`<p>${'a'.repeat(150_000)}</p>`)).toBeNull();
  });
});
