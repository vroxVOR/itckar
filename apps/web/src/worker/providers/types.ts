export interface SendResult {
  providerMessageId?: string | undefined;
}

export interface EmailProvider {
  readonly name: string;
  send(msg: { to: string; subject: string; text: string; fromName: string }): Promise<SendResult>;
}

export interface SmsProvider {
  readonly name: string;
  send(msg: { to: string; text: string; senderId?: string | undefined }): Promise<SendResult>;
}
