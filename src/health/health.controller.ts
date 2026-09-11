import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { Response } from 'express';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  liveness() {
    return { status: 'ok' };
  }

  @Get('ready')
  async readiness(@Res() res: Response) {
    const checks: Record<string, 'ok' | 'error'> = {
      database: 'ok',
      redis: 'ok',
    };

    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      checks.database = 'error';
    }

    try {
      await this.redis.ping();
    } catch {
      checks.redis = 'error';
    }

    const healthy = Object.values(checks).every((v) => v === 'ok');
    res.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
      status: healthy ? 'ok' : 'error',
      checks,
    });
  }
}
