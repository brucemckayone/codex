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
  /** Set when email was skipped (e.g., user opted out of this category) */
  skipped?: string;
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
