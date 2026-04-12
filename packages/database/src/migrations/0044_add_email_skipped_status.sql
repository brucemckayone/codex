-- Add 'skipped' value to email_send_status enum
-- Used when emails are suppressed due to user notification preferences (opt-out)
ALTER TYPE "email_send_status" ADD VALUE IF NOT EXISTS 'skipped';
