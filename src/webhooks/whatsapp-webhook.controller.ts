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

@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(
    private readonly channelsService: ChannelsService,
    private readonly channelAdapterRegistry: ChannelAdapterRegistry,
    private readonly webhooksService: WebhooksService,
  ) {}

  @Get()
  verify(@Query() query: Record<string, string>, @Res() res: Response) {
    const adapter = this.channelAdapterRegistry.get(ChannelType.WHATSAPP);
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
    @Body() payload: unknown,
    @Headers() headers: Record<string, string>,
    @Req() request: Request,
  ) {
    const adapter = this.channelAdapterRegistry.get(ChannelType.WHATSAPP);
    const rawBody =
      (request as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from('');
    if (!adapter.verifySignature(rawBody, headers)) {
      throw new ForbiddenException('Invalid webhook signature');
    }

    const externalAccountId = adapter.extractExternalAccountId(payload);
    if (!externalAccountId) return { status: 'ignored' };

    const connection = await this.channelsService.findByExternalAccountId(
      ChannelType.WHATSAPP,
      externalAccountId,
    );
    if (!connection) return { status: 'ignored' };

    const eventKeys = adapter.extractEventKeys(payload);
    if (eventKeys.length > 0) {
      await this.webhooksService.ingest(
        'whatsapp',
        connection.id,
        payload,
        eventKeys,
      );
    }

    return { status: 'ok' };
  }
}
