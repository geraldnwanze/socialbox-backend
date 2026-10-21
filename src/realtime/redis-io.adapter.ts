import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import type { ServerOptions } from 'socket.io';

/**
 * Makes the API's Socket.IO server listen on Redis pub/sub, so events published by *other*
 * processes (the worker, which handles inbound webhooks) reach browsers connected to the API.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly pub: Redis;
  private readonly sub: Redis;

  constructor(app: INestApplicationContext, redis: Redis) {
    super(app);
    this.pub = redis.duplicate();
    this.sub = redis.duplicate();
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    server.adapter(createAdapter(this.pub, this.sub));
    return server;
  }

  async close(server: Parameters<IoAdapter['close']>[0]) {
    await super.close(server);
    this.pub.disconnect();
    this.sub.disconnect();
  }
}
