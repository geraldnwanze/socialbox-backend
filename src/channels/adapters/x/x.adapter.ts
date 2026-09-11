import { Injectable } from '@nestjs/common';
import { ChannelConnection } from '../../entities/channel-connection.entity';
import { ChannelType } from '../../enums/channel-type.enum';
import {
  ChannelAdapter,
  ChannelCapabilities,
  ConnectChannelInput,
  ConnectChannelResult,
  NormalizedWebhookEvent,
  OutboundMessage,
  SendMessageResult,
  UnifiedConversation,
} from '../../interfaces/channel-adapter.interface';
import { AppException } from '../../../common/exceptions/app.exception';
import { HttpStatus } from '@nestjs/common';

/**
 * X (Twitter) DM API is real and technically reachable, but every request is billed under
 * X's pay-per-use model and recipients must have opted in to receive DMs from the app — there
 * is no way to exercise it without a funded, billed developer account. This adapter is
 * therefore a deliberate stub: it satisfies the ChannelAdapter contract (so the registry and
 * UI can list it as "Coming soon") but never sends or simulates a real message. See
 * docs/social-platform-capabilities.md.
 */
@Injectable()
export class XAdapter implements ChannelAdapter {
  readonly type = ChannelType.X;
  readonly capabilities: ChannelCapabilities = {
    sendText: false,
    sendImage: false,
    sendVideo: false,
    sendAudio: false,
    sendDocument: false,
    markAsRead: false,
    deliveryReceipts: false,
    readReceipts: false,
  };

  private notImplemented(): never {
    throw new AppException(
      'CHANNEL_PENDING',
      'X is not yet available — it requires a billed X API account (see docs/social-platform-capabilities.md)',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  connect(_input: ConnectChannelInput): Promise<ConnectChannelResult> {
    return this.notImplemented();
  }

  disconnect(_connection: ChannelConnection): Promise<void> {
    return this.notImplemented();
  }

  sendMessage(
    _connection: ChannelConnection,
    _conversation: UnifiedConversation,
    _message: OutboundMessage,
  ): Promise<SendMessageResult> {
    return this.notImplemented();
  }

  verifySignature(): boolean {
    return false;
  }

  extractExternalAccountId(): string | null {
    return null;
  }

  extractEventKeys(): string[] {
    return [];
  }

  handleWebhook(): Promise<NormalizedWebhookEvent[]> {
    return this.notImplemented();
  }
}
