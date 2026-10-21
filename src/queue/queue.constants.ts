export enum QueueName {
  WEBHOOKS = 'webhooks',
  OUTBOUND_MESSAGES = 'outbound-messages',
  MEDIA = 'media',
  NOTIFICATIONS = 'notifications',
  EMAIL_SYNC = 'email-sync',
}

export enum WebhookJobName {
  PROCESS_EVENT = 'process-event',
}

export enum OutboundMessageJobName {
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

export interface MirrorMediaJob {
  attachmentId: string;
}

export interface DispatchNotificationJob {
  notificationId: string;
}
