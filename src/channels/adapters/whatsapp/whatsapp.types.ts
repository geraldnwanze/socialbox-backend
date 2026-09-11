export interface WhatsAppMediaObject {
  id?: string;
  link?: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
}

export interface WhatsAppInboundMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: WhatsAppMediaObject;
  video?: WhatsAppMediaObject;
  audio?: WhatsAppMediaObject;
  document?: WhatsAppMediaObject;
  sticker?: WhatsAppMediaObject;
}

export interface WhatsAppContact {
  wa_id: string;
  profile?: { name?: string };
}

export interface WhatsAppStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  errors?: { code: number; title: string }[];
}

export interface WhatsAppValue {
  messaging_product: 'whatsapp';
  metadata: { display_phone_number: string; phone_number_id: string };
  contacts?: WhatsAppContact[];
  messages?: WhatsAppInboundMessage[];
  statuses?: WhatsAppStatus[];
}

export interface WhatsAppWebhookPayload {
  object: string;
  entry: { id: string; changes: { field: string; value: WhatsAppValue }[] }[];
}
