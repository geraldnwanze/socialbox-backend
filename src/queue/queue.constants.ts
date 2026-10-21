export enum QueueName {
  WEBHOOKS = 'webhooks',
  OUTBOUND_MESSAGES = 'outbound-messages',
  MEDIA = 'media',
  NOTIFICATIONS = 'notifications',
  EMAIL_SYNC = 'email-sync',
  READ_RECEIPTS = 'read-receipts',
}

export enum WebhookJobName {
  PROCESS_EVENT = 'process-event',
}

export enum OutboundMessageJobName {
  SEND = 'send',
}

export enum ReadReceiptJobName {
  SEND = 'send',
}

export enum MediaJobName {
  MIRROR_TO_STORAGE = 'mirror-to-storage',
}

export enum NotificationJobName {
  DISPATCH = 'dispatch',
}

export interface ProcessWebhookEventJob {
  webhookEventId: string;
}

export interface SendOutboundMessageJob {
  messageId: string;
}

export interface SendReadReceiptJob {
  conversationId: string;
  /** Provider ids of the inbound messages the agent just read, oldest first. */
  externalMessageIds: string[];
}

export interface MirrorMediaJob {
  attachmentId: string;
}

export interface DispatchNotificationJob {
  notificationId: string;
}
