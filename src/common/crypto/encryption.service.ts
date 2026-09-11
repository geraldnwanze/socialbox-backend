import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * Encrypts channel OAuth credentials (access/refresh tokens) at rest.
 * Ciphertext format: base64(iv):base64(authTag):base64(ciphertext)
 */
@Injectable()
export class EncryptionService implements OnModuleInit {
  private key: Buffer;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const rawKey = this.configService.get<string>('credentialsEncryptionKey');
    if (!rawKey) {
      if (this.configService.get<string>('nodeEnv') === 'production') {
        throw new Error('CREDENTIALS_ENCRYPTION_KEY must be set in production');
      }
      // Deterministic dev-only fallback so local setup doesn't require generating a key.
      this.key = Buffer.alloc(32, 'socialbox-dev-key');
      return;
    }
    const decoded = Buffer.from(rawKey, 'base64');
    if (decoded.length !== 32) {
      throw new Error(
        'CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes (base64)',
      );
    }
    this.key = decoded;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const [ivB64, authTagB64, ciphertextB64] = payload.split(':');
    if (!ivB64 || !authTagB64 || !ciphertextB64) {
      throw new Error('Malformed encrypted payload');
    }
    const decipher = createDecipheriv(
      ALGORITHM,
      this.key,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}
