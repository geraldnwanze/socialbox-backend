export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  from: TelegramUser;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  video?: TelegramDocument;
  voice?: TelegramDocument;
  audio?: TelegramDocument;
  document?: TelegramDocument;
  sticker?: TelegramDocument;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramFile {
  file_id: string;
  file_path?: string;
}

export interface TelegramSendResponse {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
}
