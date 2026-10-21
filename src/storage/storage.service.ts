import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

/**
 * Cloudflare R2 is S3-compatible, so the AWS SDK's S3 client talks to it directly by pointing
 * `endpoint` at the account's R2 endpoint. Storage stays private — every read goes through a
 * short-lived signed URL rather than a public bucket.
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  /** Signs URLs for browsers; differs from `client` only when storage has a separate public address. */
  private readonly signingClient: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    this.bucket = this.configService.get<string>('r2.bucket')!;
    const endpoint = this.configService.get<string>('r2.endpoint');
    const publicEndpoint = this.configService.get<string>('r2.publicEndpoint');
    const make = (url?: string) =>
      new S3Client({
        region: 'auto',
        endpoint: url,
        // Self-hosted S3 (MinIO, ...) addresses buckets by path, not subdomain.
        forcePathStyle: !!url && !url.includes('r2.cloudflarestorage.com'),
        credentials: {
          accessKeyId: this.configService.get<string>('r2.accessKeyId') ?? '',
          secretAccessKey:
            this.configService.get<string>('r2.secretAccessKey') ?? '',
        },
      });
    this.client = make(endpoint);
    this.signingClient =
      publicEndpoint && publicEndpoint !== endpoint
        ? make(publicEndpoint)
        : this.client;
  }

  buildKey(workspaceId: string, fileName: string): string {
    const ext = fileName.includes('.') ? fileName.split('.').pop() : undefined;
    return `workspaces/${workspaceId}/${randomUUID()}${ext ? `.${ext}` : ''}`;
  }

  async upload(key: string, body: Buffer, mimeType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: mimeType,
      }),
    );
  }

  /** Downloads a provider-hosted URL and mirrors it into R2 so media outlives short-lived provider links. */
  async mirrorFromUrl(
    workspaceId: string,
    sourceUrl: string,
    fileName: string,
    mimeType: string,
  ): Promise<string> {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to download media from provider: HTTP ${response.status}`,
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const key = this.buildKey(workspaceId, fileName);
    await this.upload(key, buffer, mimeType);
    return key;
  }

  /**
   * `fileName` forces the browser to download rather than render the object: customer-supplied
   * HTML/SVG served inline from the storage origin could otherwise run script there.
   */
  async getSignedDownloadUrl(
    key: string,
    expiresInSeconds = 3600,
    fileName?: string,
    /** Sign for our own server to fetch (internal address) instead of for a browser/provider. */
    forServer = false,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(fileName && {
        ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      }),
    });
    return getSignedUrl(forServer ? this.client : this.signingClient, command, {
      expiresIn: expiresInSeconds,
    });
  }

  async getSignedUploadUrl(
    key: string,
    mimeType: string,
    expiresInSeconds = 900,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
    });
    return getSignedUrl(this.signingClient, command, {
      expiresIn: expiresInSeconds,
    });
  }
}
