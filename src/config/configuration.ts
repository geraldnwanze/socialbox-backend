export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3001', 10),
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  apiUrl: process.env.API_URL ?? 'http://localhost:3001',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  network: {
    // How many reverse proxies sit in front of the API (ngrok/Nginx = 1; Cloudflare + Nginx = 2).
    // Express uses this to read the real client IP from X-Forwarded-For instead of the proxy's.
    trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10),
    // Only enable when the API is reachable *exclusively* through Cloudflare: otherwise anyone
    // can send a forged CF-Connecting-IP / CF-IPCountry header.
    trustCloudflareHeaders: process.env.TRUST_CLOUDFLARE_HEADERS === 'true',
  },

  database: {
    url: process.env.DATABASE_URL,
  },

  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },

  auth: {
    jwtSecret: process.env.JWT_SECRET,
    jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
    jwtRefreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  },

  credentialsEncryptionKey: process.env.CREDENTIALS_ENCRYPTION_KEY,

  sentry: {
    dsn: process.env.SENTRY_DSN,
  },

  r2: {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET ?? 'socialbox-media',
    endpoint: process.env.R2_ENDPOINT,
  },

  whatsapp: {
    appSecret: process.env.WHATSAPP_APP_SECRET,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    apiVersion: process.env.WHATSAPP_API_VERSION ?? 'v21.0',
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
  },

  meta: {
    appSecret: process.env.META_APP_SECRET,
    verifyToken: process.env.META_VERIFY_TOKEN,
    apiVersion: process.env.META_API_VERSION ?? 'v21.0',
  },
});
