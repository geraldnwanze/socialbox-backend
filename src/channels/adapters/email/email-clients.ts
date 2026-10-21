import { HttpStatus } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { createTransport, Transporter } from 'nodemailer';
import { AppException } from '../../../common/exceptions/app.exception';
import { EmailCredentials, resolveMailHost } from './email-config';

const TIMEOUT_MS = 15_000;

export async function createImapClient(
  creds: EmailCredentials,
  allowPrivate: boolean,
): Promise<ImapFlow> {
  const { address, servername } = await resolveMailHost(
    creds.imapHost,
    allowPrivate,
  );
  const client = new ImapFlow({
    host: address,
    port: creds.imapPort,
    secure: creds.imapSecurity === 'SSL',
    servername,
    doSTARTTLS:
      creds.imapSecurity === 'STARTTLS'
        ? true
        : creds.imapSecurity === 'NONE'
          ? false
          : undefined,
    auth: { user: creds.username, pass: creds.password },
    logger: false,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: 60_000,
  });
  // An unhandled 'error' event (e.g. the server dropping the socket) would crash the process.
  client.on('error', () => undefined);
  return client;
}

export async function createSmtpTransport(
  creds: EmailCredentials,
  allowPrivate: boolean,
): Promise<Transporter> {
  const { address, servername } = await resolveMailHost(
    creds.smtpHost,
    allowPrivate,
  );
  return createTransport({
    host: address,
    port: creds.smtpPort,
    secure: creds.smtpSecurity === 'SSL',
    requireTLS: creds.smtpSecurity === 'STARTTLS',
    ignoreTLS: creds.smtpSecurity === 'NONE',
    tls: { servername },
    auth: { user: creds.username, pass: creds.password },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: 30_000,
  });
}

interface MailError {
  code?: string;
  responseCode?: number;
  authenticationFailed?: boolean;
  message?: string;
}

/** Turns a transport error into something a person can act on, without leaking server chatter. */
export function describeMailError(
  error: unknown,
  server: 'IMAP' | 'SMTP',
  host: string,
): AppException {
  if (error instanceof AppException) return error;
  const e = error as MailError;
  const fail = (message: string) =>
    new AppException(
      'EMAIL_CONNECTION_FAILED',
      message,
      HttpStatus.BAD_REQUEST,
    );

  if (e.authenticationFailed || e.code === 'EAUTH' || e.responseCode === 535) {
    return fail(
      `${server} sign-in was rejected. Check the username and password — Gmail and Outlook need an app password, not your normal one.`,
    );
  }
  if (e.code === 'ECONNREFUSED' || e.code === 'NoConnection') {
    return fail(
      `${server} server ${host} refused the connection. Check the port and security setting.`,
    );
  }
  if (
    e.code === 'ETIMEDOUT' ||
    e.code === 'ESOCKET' ||
    e.code === 'ECONNECTION'
  ) {
    return fail(
      `Couldn't reach the ${server} server ${host} (timed out). Check the host, port and security setting.`,
    );
  }
  if (e.code === 'ENOTFOUND') {
    return fail(`Couldn't find the ${server} server "${host}".`);
  }
  if (e.code && /CERT|TLS|SSL|ALTNAME|SELF_SIGNED/i.test(e.code)) {
    return fail(
      `The ${server} server ${host} presented an untrusted TLS certificate.`,
    );
  }
  return fail(`Couldn't connect to the ${server} server ${host}.`);
}

export type { Transporter };
