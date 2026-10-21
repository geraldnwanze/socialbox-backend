import { VisitorInfoService, sanitizePageUrl } from './visitor-info';

const service = async (trustCloudflare: boolean) => {
  const svc = new VisitorInfoService({ get: () => trustCloudflare } as never);
  await svc.onModuleInit();
  return svc;
};

describe('sanitizePageUrl', () => {
  it('keeps a normal page URL but drops credentials and the fragment', async () => {
    expect(
      sanitizePageUrl('https://user:pw@shop.example.com/cart?id=3#secret'),
    ).toBe('https://shop.example.com/cart?id=3');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'ftp://x.com',
    'not a url',
    42,
    undefined,
  ])('rejects %p', (value) => {
    expect(sanitizePageUrl(value)).toBeUndefined();
  });

  it('bounds the stored length', async () => {
    const long = 'https://example.com/' + 'a'.repeat(1500);
    expect(sanitizePageUrl(long)!.length).toBeLessThanOrEqual(500);
  });
});

describe('VisitorInfoService', () => {
  it('uses req.ip and looks the country up locally, normalizing IPv4-mapped IPv6', async () => {
    const info = (await service(false)).fromRequest({
      ip: '::ffff:8.8.8.8',
      headers: {},
    } as never);
    expect(info).toEqual({ ip: '8.8.8.8', countryCode: 'US' });
  });

  it('knows recently allocated African ranges (regression: 102.209.x.x was unknown to the old GeoIP data)', async () => {
    const info = (await service(false)).fromRequest({
      ip: '102.209.29.151',
      headers: {},
    } as never);
    expect(info.countryCode).toBe('NG');
  });

  it('returns no country for private addresses', async () => {
    const info = (await service(false)).fromRequest({
      ip: '192.168.1.5',
      headers: {},
    } as never);
    expect(info).toEqual({ ip: '192.168.1.5', countryCode: undefined });
  });

  it('ignores forged Cloudflare headers unless Cloudflare is explicitly trusted', async () => {
    const req = {
      ip: '8.8.8.8',
      headers: { 'cf-connecting-ip': '41.58.0.1', 'cf-ipcountry': 'NG' },
    } as never;
    expect((await service(false)).fromRequest(req)).toEqual({
      ip: '8.8.8.8',
      countryCode: 'US',
    });
    expect((await service(true)).fromRequest(req)).toEqual({
      ip: '41.58.0.1',
      countryCode: 'NG',
    });
  });

  it('ignores Cloudflare placeholder countries and falls back to the lookup', async () => {
    const req = { ip: '8.8.8.8', headers: { 'cf-ipcountry': 'XX' } } as never;
    expect((await service(true)).fromRequest(req).countryCode).toBe('US');
  });

  it('returns nothing when there is no IP at all', async () => {
    expect(
      (await service(false)).fromRequest({ headers: {} } as never),
    ).toEqual({});
  });
});
