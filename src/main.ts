import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import * as Sentry from '@sentry/node';
import { AppModule } from './app.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RedisIoAdapter } from './realtime/redis-io.adapter';
import { REDIS_CLIENT } from './redis/redis.module';

async function bootstrap() {
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
    });
  }

  // rawBody is required to verify WhatsApp/Meta's X-Hub-Signature-256 HMAC against the exact
  // bytes they sent — the parsed/re-serialized JSON body would not reproduce the same signature.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const configService = app.get(ConfigService);

  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', configService.get<number>('network.trustProxyHops'));
  app.useWebSocketAdapter(new RedisIoAdapter(app, app.get(REDIS_CLIENT)));
  app.use(helmet());
  app.use(new RequestIdMiddleware().use);
  const dashboardCors = {
    origin: configService.get<string[]>('corsOrigins'),
    credentials: true,
  };
  // The chat widget runs on customers' own websites, so its public endpoints must accept any
  // origin (each endpoint enforces the workspace's allowed-origins list itself). Everything else
  // stays restricted to the dashboard origins. No credentials/cookies are involved for the widget.
  app.enableCors((req, callback) => {
    const isWidget = String(req.url ?? '').startsWith('/widget');
    callback(
      null,
      isWidget
        ? {
            origin: true,
            credentials: false,
            allowedHeaders: ['authorization', 'content-type'],
          }
        : dashboardCors,
    );
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.enableShutdownHooks();

  const port = configService.get<number>('port') ?? 3001;
  await app.listen(port);
}

bootstrap();
