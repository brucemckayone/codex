export interface EmailMessage {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface EmailProvider {
  /** Provider name for logging */
  readonly name: string;

  /** Send an email */
  send(message: EmailMessage, from: EmailFrom): Promise<SendResult>;
}

export interface EmailFrom {
  email: string;
  name?: string;
}
