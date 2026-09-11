export enum MessageDirection {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
}

export enum MessageType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
  AUDIO = 'AUDIO',
  DOCUMENT = 'DOCUMENT',
  STICKER = 'STICKER',
  SYSTEM = 'SYSTEM',
  UNKNOWN = 'UNKNOWN',
}

export enum MessageStatus {
  RECEIVED = 'RECEIVED',
  QUEUED = 'QUEUED',
  SENDING = 'SENDING',
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  READ = 'READ',
  FAILED = 'FAILED',
}

export enum SenderType {
  CONTACT = 'CONTACT',
  AGENT = 'AGENT',
  SYSTEM = 'SYSTEM',
}
