import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
    });
  }

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'warn', 'error'],
  });
  app.enableShutdownHooks();

  Logger.log(
    'Worker started — listening on webhooks, outbound-messages, media, notifications queues',
    'Bootstrap',
  );
}

bootstrap();
