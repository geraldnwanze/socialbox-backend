export interface MetaAttachment {
  type: 'image' | 'video' | 'audio' | 'file';
  payload: { url?: string };
}

export interface MetaMessage {
  mid: string;
  text?: string;
  attachments?: MetaAttachment[];
  is_echo?: boolean;
}

export interface MetaMessagingEntry {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: MetaMessage;
  delivery?: { mids?: string[]; watermark: number };
  read?: { watermark: number };
}

export interface MetaWebhookEntry {
  id: string;
  time?: number;
  messaging?: MetaMessagingEntry[];
}

export interface MetaWebhookPayload {
  object: 'page' | 'instagram';
  entry: MetaWebhookEntry[];
}
