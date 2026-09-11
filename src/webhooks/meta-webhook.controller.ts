import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ChannelsService } from '../channels/channels.service';
import { ChannelAdapterRegistry } from '../channels/channel-adapter.registry';
import { ChannelType } from '../channels/enums/channel-type.enum';
import { WebhooksService } from './webhooks.service';

interface MetaEnvelope {
  object?: string;
}

/**
 * Messenger and Instagram share one Meta App webhook subscription, distinguished only by the
 * `object` field of the payload — this mirrors how a real Meta App is configured (one Callback
 * URL for both products) rather than inventing two separate endpoints.
 */
@Controller('webhooks/meta')
export class MetaWebhookController {
  constructor(
    private readonly channelsService: ChannelsService,
    private readonly channelAdapterRegistry: ChannelAdapterRegistry,
    private readonly webhooksService: WebhooksService,
  ) {}

  @Get()
  verify(@Query() query: Record<string, string>, @Res() res: Response) {
    const adapter = this.channelAdapterRegistry.get(
      ChannelType.FACEBOOK_MESSENGER,
    );
    const result = adapter.verifyWebhookHandshake!({ query });
    if (result.ok) {
      res.status(HttpStatus.OK).send(result.challenge);
    } else {
      res.status(HttpStatus.FORBIDDEN).send();
    }
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(
    @Body() payload: MetaEnvelope,
    @Headers() headers: Record<string, string>,
    @Req() request: Request,
  ) {
    const channelType = this.resolveChannelType(payload.object);
    if (!channelType) return { status: 'ignored' };

    const adapter = this.channelAdapterRegistry.get(channelType);
    const rawBody =
      (request as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from('');
    if (!adapter.verifySignature(rawBody, headers)) {
      throw new ForbiddenException('Invalid webhook signature');
    }

    const externalAccountId = adapter.extractExternalAccountId(payload);
    if (!externalAccountId) return { status: 'ignored' };

    const connection = await this.channelsService.findByExternalAccountId(
      channelType,
      externalAccountId,
    );
    if (!connection) return { status: 'ignored' };

    const eventKeys = adapter.extractEventKeys(payload);
    if (eventKeys.length > 0) {
      await this.webhooksService.ingest(
        channelType.toLowerCase(),
        connection.id,
        payload,
        eventKeys,
      );
    }

    return { status: 'ok' };
  }

  private resolveChannelType(object?: string): ChannelType | null {
    if (object === 'page') return ChannelType.FACEBOOK_MESSENGER;
    if (object === 'instagram') return ChannelType.INSTAGRAM;
    return null;
  }
}
