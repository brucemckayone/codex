// See /design/features/notifications/ttd-dphase-1.md

/**
 * Email payload (provider-agnostic)
 */
export interface EmailPayload {
  /** Template identifier (e.g., 'email-verification', 'password-reset') */
  template: string;

  /** Recipient email address */
  recipient: string;

  /** Template data for interpolation */
  data: Record<string, any>;

  /** Optional: Reply-to address */
  replyTo?: string;
}

/**
 * Email send result
 */
export interface EmailResult {
  /** Whether email was sent successfully */
  success: boolean;

  /** Provider's email ID (for tracking) */
  emailId?: string;

  /** Error message (if failed) */
  error?: string;
}

/**
 * Notification Service Interface
 * All features use this interface (never call adapters directly)
 */
export interface INotificationService {
  /**
   * Send an email using a template
   * @throws Error if template not found or sending fails after retry
   */
  sendEmail(payload: EmailPayload): Promise<EmailResult>;
}
