import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelType } from '../../enums/channel-type.enum';
import { ConnectChannelResult } from '../../interfaces/channel-adapter.interface';
import { MessageSendFailedException } from '../../../common/exceptions/app.exception';
import { MetaMessagingAdapterBase } from './meta-messaging.adapter-base';

/**
 * Facebook Messenger Platform. Works today against a Page this app's developer account
 * administers; onboarding other businesses' Pages needs Meta App Review (Advanced Access) +
 * Business Verification — see docs/social-platform-capabilities.md.
 */
@Injectable()
export class MessengerAdapter extends MetaMessagingAdapterBase {
  readonly type = ChannelType.FACEBOOK_MESSENGER;
  readonly webhookObjectType = 'page' as const;

  constructor(configService: ConfigService) {
    super(configService);
  }

  async connect(input: Record<string, unknown>): Promise<ConnectChannelResult> {
    const pageAccessToken = input.pageAccessToken as string;
    const pageId = input.pageId as string;
    if (!pageAccessToken || !pageId) {
      throw new MessageSendFailedException(
        'A Page access token and Page id are required',
      );
    }

    const response = await fetch(
      `https://graph.facebook.com/${this.configService.get<string>('meta.apiVersion') ?? 'v21.0'}/${pageId}?fields=name&access_token=${encodeURIComponent(pageAccessToken)}`,
    );
    const body = (await response.json()) as {
      name?: string;
      error?: { message: string };
    };
    if (!response.ok) {
      throw new MessageSendFailedException(
        body.error?.message ?? 'Meta rejected these credentials',
      );
    }

    return {
      externalAccountId: pageId,
      externalAccountName: body.name,
      credentials: { pageAccessToken, pageId },
    };
  }
}
