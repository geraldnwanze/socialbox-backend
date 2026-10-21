import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as maxmind from 'maxmind';
import type { CountryResponse, Reader } from 'maxmind';
import type { Request } from 'express';

export interface VisitorInfo {
  ip?: string;
  countryCode?: string;
}

/** Page addresses come from the visitor's browser, so treat them as display-only data: http(s)
 *  only, no credentials or fragment, bounded length. Anything else is dropped. */
export function sanitizePageUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 2000) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.toString().slice(0, 500);
  } catch {
    return undefined;
  }
}

@Injectable()
export class VisitorInfoService implements OnModuleInit {
  private readonly logger = new Logger(VisitorInfoService.name);
  private readonly trustCloudflare: boolean;
  private geo?: Reader<CountryResponse>;

  constructor(configService: ConfigService) {
    this.trustCloudflare =
      configService.get<boolean>('network.trustCloudflareHeaders') ?? false;
  }

  /**
   * Country data is the DB-IP "lite" country database (CC BY 4.0 — attribution is shown next to the
   * country in the dashboard), shipped via the @ip-location-db npm package so a package update
   * refreshes it. A missing database only means countries show as unknown — never a crash.
   */
  async onModuleInit() {
    try {
      const file =
        require.resolve('@ip-location-db/dbip-country-mmdb/dbip-country.mmdb');
      this.geo = await maxmind.open<CountryResponse>(file);
    } catch (error) {
      this.logger.warn(
        `GeoIP database unavailable, countries will be unknown: ${(error as Error).message}`,
      );
    }
  }

  /** Real client IP and country for a request. Express's `req.ip` already honours the
   *  configured number of trusted proxy hops (see main.ts). */
  fromRequest(req: Pick<Request, 'ip' | 'headers'>): VisitorInfo {
    const header = (name: string) => {
      const value = req.headers[name];
      return Array.isArray(value) ? value[0] : value;
    };

    const rawIp =
      (this.trustCloudflare ? header('cf-connecting-ip') : undefined) ?? req.ip;
    const ip = rawIp?.replace(/^::ffff:/, '');
    if (!ip) return {};

    let countryCode: string | undefined;
    if (this.trustCloudflare) {
      const cf = header('cf-ipcountry')?.toUpperCase();
      // XX = unknown, T1 = Tor: not real countries.
      if (cf && /^[A-Z]{2}$/.test(cf) && cf !== 'XX' && cf !== 'T1') {
        countryCode = cf;
      }
    }
    countryCode ??= this.lookupCountry(ip);

    return { ip, countryCode };
  }

  private lookupCountry(ip: string): string | undefined {
    try {
      // The DB-IP database stores a flat { country_code } record, not MaxMind's nested country object.
      const record = this.geo?.get(ip) as unknown as
        { country_code?: string } | null | undefined;
      return record?.country_code || undefined;
    } catch {
      return undefined; // malformed address
    }
  }
}
