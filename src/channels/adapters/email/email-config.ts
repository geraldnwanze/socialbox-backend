import { HttpStatus } from '@nestjs/common';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { AppException } from '../../../common/exceptions/app.exception';

export type MailSecurity = 'SSL' | 'STARTTLS' | 'NONE';

/** Everything needed to read and send as one mailbox. Stored encrypted; never returned by the API. */
export interface EmailCredentials {
  /** The address people write to and replies come from. */
  email: string;
  fromName?: string;
  username: string;
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: MailSecurity;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: MailSecurity;
}

const invalid = (message: string) =>
  new AppException('INVALID_CHANNEL_SETTINGS', message, HttpStatus.BAD_REQUEST);

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i;

function text(
  input: Record<string, unknown>,
  key: string,
  label: string,
  max: number,
  required = true,
): string {
  const value = input[key];
  if (value === undefined || value === null || value === '') {
    if (required) throw invalid(`${label} is required`);
    return '';
  }
  if (typeof value !== 'string' || value.length > max) {
    throw invalid(`${label} must be text of at most ${max} characters`);
  }
  return value.trim();
}

function port(input: Record<string, unknown>, key: string, fallback: number) {
  const raw = input[key];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw invalid('Ports must be numbers between 1 and 65535');
  }
  return n;
}

function security(
  input: Record<string, unknown>,
  key: string,
  fallback: MailSecurity,
  allowNone: boolean,
): MailSecurity {
  const raw = input[key];
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (raw !== 'SSL' && raw !== 'STARTTLS' && raw !== 'NONE') {
    throw invalid('Security must be SSL, STARTTLS or NONE');
  }
  if (raw === 'NONE' && !allowNone) {
    throw invalid(
      'Unencrypted connections are not allowed — use SSL or STARTTLS',
    );
  }
  return raw;
}

function host(input: Record<string, unknown>, key: string, label: string) {
  const value = text(input, key, label, 253).toLowerCase();
  if (!HOST_RE.test(value)) throw invalid(`${label} is not a valid host name`);
  return value;
}

/** Validates the connect form. `allowInsecure` (dev/test only) permits unencrypted transport. */
export function parseEmailInput(
  input: Record<string, unknown>,
  allowInsecure: boolean,
): EmailCredentials {
  const email = text(input, 'email', 'Email address', 254).toLowerCase();
  if (!EMAIL_RE.test(email)) throw invalid('Email address is not valid');
  return {
    email,
    fromName: text(input, 'fromName', 'Sender name', 80, false) || undefined,
    username: text(input, 'username', 'Username', 254, false) || email,
    password: text(input, 'password', 'Password', 512),
    imapHost: host(input, 'imapHost', 'IMAP host'),
    imapPort: port(input, 'imapPort', 993),
    imapSecurity: security(input, 'imapSecurity', 'SSL', allowInsecure),
    smtpHost: host(input, 'smtpHost', 'SMTP host'),
    smtpPort: port(input, 'smtpPort', 587),
    smtpSecurity: security(input, 'smtpSecurity', 'STARTTLS', allowInsecure),
  };
}

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
  const v4mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (v4mapped) return isPrivateAddress(v4mapped[1]);

  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    return (
      lower === '::' ||
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      /^fe[89ab]/.test(lower) ||
      lower.startsWith('ff')
    );
  }
  return true; // not an IP at all — treat as unsafe
}

export interface ResolvedHost {
  /** The IP to actually connect to — resolved once so it cannot change between check and use. */
  address: string;
  /** The original name, for TLS certificate validation. */
  servername: string;
}

/**
 * Resolves a user-supplied mail host and refuses internal addresses, so a workspace admin cannot
 * point the server at its own network (databases, cloud metadata, ...). Dev/test setups that
 * genuinely use a private mail server opt in with EMAIL_ALLOW_PRIVATE_HOSTS=true.
 */
export async function resolveMailHost(
  hostname: string,
  allowPrivate: boolean,
): Promise<ResolvedHost> {
  let addresses: string[];
  if (isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      addresses = (await lookup(hostname, { all: true })).map((a) => a.address);
    } catch {
      throw invalid(`Couldn't find a server named "${hostname}"`);
    }
  }
  if (addresses.length === 0) {
    throw invalid(`Couldn't find a server named "${hostname}"`);
  }
  if (!allowPrivate && addresses.some(isPrivateAddress)) {
    throw invalid(
      `"${hostname}" points to a private network address, which is not allowed`,
    );
  }
  return { address: addresses[0], servername: hostname };
}
