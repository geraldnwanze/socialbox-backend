import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { ChannelsService } from '../channels/channels.service';
import { ChannelAdapterRegistry } from '../channels/channel-adapter.registry';
import { ChannelType } from '../channels/enums/channel-type.enum';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks/telegram')
export class TelegramWebhookController {
  constructor(
    private readonly channelsService: ChannelsService,
    private readonly channelAdapterRegistry: ChannelAdapterRegistry,
    private readonly webhooksService: WebhooksService,
  ) {}

  @Post(':connectionId')
  @HttpCode(HttpStatus.OK)
  async handle(
    @Param('connectionId') connectionId: string,
    @Body() payload: unknown,
    @Headers() headers: Record<string, string>,
    @Req() request: Request,
  ) {
    const connection =
      await this.channelsService.loadWithCredentials(connectionId);
    if (connection.type !== ChannelType.TELEGRAM) {
      throw new ForbiddenException();
    }

    const adapter = this.channelAdapterRegistry.get(ChannelType.TELEGRAM);
    const rawBody =
      (request as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from('');
    if (!adapter.verifySignature(rawBody, headers)) {
      throw new ForbiddenException('Invalid webhook secret');
    }

    const eventKeys = adapter.extractEventKeys(payload);
    if (eventKeys.length > 0) {
      await this.webhooksService.ingest(
        'telegram',
        connection.id,
        payload,
        eventKeys,
      );
    }

    return { status: 'ok' };
  }
}
