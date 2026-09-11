import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelType } from '../../enums/channel-type.enum';
import { ConnectChannelResult } from '../../interfaces/channel-adapter.interface';
import { MessageSendFailedException } from '../../../common/exceptions/app.exception';
import { MetaMessagingAdapterBase } from './meta-messaging.adapter-base';

/**
 * Instagram Messaging API. Works today for up to 25 test users without App Review; messaging
 * accounts this app doesn't own needs the same App Review (Advanced Access) + Business
 * Verification as Messenger — see docs/social-platform-capabilities.md.
 */
@Injectable()
export class InstagramAdapter extends MetaMessagingAdapterBase {
  readonly type = ChannelType.INSTAGRAM;
  readonly webhookObjectType = 'instagram' as const;

  constructor(configService: ConfigService) {
    super(configService);
  }

  async connect(input: Record<string, unknown>): Promise<ConnectChannelResult> {
    const pageAccessToken = input.pageAccessToken as string;
    const instagramAccountId = input.instagramAccountId as string;
    if (!pageAccessToken || !instagramAccountId) {
      throw new MessageSendFailedException(
        'A Page access token and Instagram account id are required',
      );
    }

    const response = await fetch(
      `https://graph.facebook.com/${this.configService.get<string>('meta.apiVersion') ?? 'v21.0'}/${instagramAccountId}?fields=username&access_token=${encodeURIComponent(pageAccessToken)}`,
    );
    const body = (await response.json()) as {
      username?: string;
      error?: { message: string };
    };
    if (!response.ok) {
      throw new MessageSendFailedException(
        body.error?.message ?? 'Meta rejected these credentials',
      );
    }

    return {
      externalAccountId: instagramAccountId,
      externalAccountName: body.username,
      credentials: { pageAccessToken, instagramAccountId },
    };
  }
}
