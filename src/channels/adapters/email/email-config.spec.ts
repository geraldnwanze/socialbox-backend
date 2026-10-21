import {
  isPrivateAddress,
  parseEmailInput,
  resolveMailHost,
} from './email-config';

const valid = {
  email: 'Support@Example.com',
  password: 'secret',
  imapHost: 'imap.example.com',
  smtpHost: 'smtp.example.com',
};

describe('parseEmailInput', () => {
  it('normalizes and applies sensible defaults', () => {
    expect(parseEmailInput(valid, false)).toMatchObject({
      email: 'support@example.com',
      username: 'support@example.com',
      imapPort: 993,
      imapSecurity: 'SSL',
      smtpPort: 587,
      smtpSecurity: 'STARTTLS',
    });
  });

  it('rejects bad addresses, hosts and ports', () => {
    expect(() => parseEmailInput({ ...valid, email: 'nope' }, false)).toThrow(
      'not valid',
    );
    expect(() => parseEmailInput({ ...valid, imapHost: 'a b' }, false)).toThrow(
      'valid host',
    );
    expect(() => parseEmailInput({ ...valid, imapPort: 70000 }, false)).toThrow(
      'Ports',
    );
    expect(() => parseEmailInput({ ...valid, password: '' }, false)).toThrow(
      'Password is required',
    );
  });

  it('refuses unencrypted transport unless explicitly allowed', () => {
    const plain = { ...valid, imapSecurity: 'NONE' };
    expect(() => parseEmailInput(plain, false)).toThrow('Unencrypted');
    expect(parseEmailInput(plain, true).imapSecurity).toBe('NONE');
  });
});

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '172.16.4.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '224.0.0.1',
  ])('treats %s as private', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111'])(
    'treats %s as public',
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe('resolveMailHost', () => {
  it('rejects internal addresses by default and allows them when opted in', async () => {
    await expect(resolveMailHost('127.0.0.1', false)).rejects.toThrow(
      'private network',
    );
    await expect(resolveMailHost('169.254.169.254', false)).rejects.toThrow(
      'private network',
    );
    await expect(resolveMailHost('127.0.0.1', true)).resolves.toEqual({
      address: '127.0.0.1',
      servername: '127.0.0.1',
    });
  });

  it('allows a public IP', async () => {
    await expect(resolveMailHost('8.8.8.8', false)).resolves.toMatchObject({
      address: '8.8.8.8',
    });
  });
});
