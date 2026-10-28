import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { and, eq } from 'drizzle-orm';
import { dbWs, schema } from '../src';

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Local-dev fallback only. In CI/production the deploy step sets DATABASE_URL
// directly in the environment; dotenv does not override existing vars, but we
// guard explicitly so the seed always uses the ambient DATABASE_URL and never
// accidentally pulls a stale local .env.dev.
if (!process.env.DATABASE_URL) {
  config({ path: path.resolve(__dirname, '../../../.env.dev') });
}

const globalTemplates = [
  {
    name: 'email-verification',
    scope: 'global' as const,
    subject: 'Verify your email address',
    htmlBody: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px; }
    .button { background-color: {{primaryColor}}; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold; }
    .logo { max-height: 40px; margin-bottom: 20px; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <img src="{{logoUrl}}" alt="{{platformName}}" class="logo" />
    <h1>Verify your email</h1>
    <p>Hi {{userName}},</p>
    <p>Welcome to {{platformName}}! Please verify your email address by clicking the button below:</p>
    <p style="text-align: center; margin: 30px 0;">
      <a href="{{verificationUrl}}" class="button" style="color: white;">Verify Email</a>
    </p>
    <p>This link expires in {{expiryHours}} hours.</p>
    <p>If you didn't create an account, you can safely ignore this email.</p>
    <div class="footer">
      <p>{{platformName}} - <a href="{{contactUrl}}">{{contactUrl}}</a></p>
    </div>
  </div>
</body>
</html>`,
    textBody: `Hi {{userName}},

Welcome to {{platformName}}! Please verify your email address by visiting the link below:

{{verificationUrl}}

This link expires in {{expiryHours}} hours.

If you didn't create an account, you can safely ignore this email.

{{platformName}}
{{contactUrl}}`,
    status: 'active' as const,
    description: 'Sent when a new user registers to verify their email address',
  },
  {
    name: 'password-reset',
    scope: 'global' as const,
    subject: 'Reset your password',
    htmlBody: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px; }
    .button { background-color: {{primaryColor}}; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold; }
    .logo { max-height: 40px; margin-bottom: 20px; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <img src="{{logoUrl}}" alt="{{platformName}}" class="logo" />
    <h1>Reset your password</h1>
    <p>Hi {{userName}},</p>
    <p>We received a request to reset your password for your {{platformName}} account. Click the button below to choose a new password:</p>
    <p style="text-align: center; margin: 30px 0;">
      <a href="{{resetUrl}}" class="button" style="color: white;">Reset Password</a>
    </p>
    <p>This link expires in {{expiryHours}} hours.</p>
    <p>If you didn't request this change, you can safely ignore this email. Your password will remain unchanged.</p>
    <div class="footer">
      <p>{{platformName}} - <a href="{{contactUrl}}">{{contactUrl}}</a></p>
    </div>
  </div>
</body>
</html>`,
    textBody: `Hi {{userName}},

We received a request to reset your password for your {{platformName}} account. Visit the link below to choose a new password:

{{resetUrl}}

This link expires in {{expiryHours}} hours.

If you didn't request this change, you can safely ignore this email. Your password will remain unchanged.

{{platformName}}
{{contactUrl}}`,
    status: 'active' as const,
    description: 'Sent when a user requests a password reset',
  },
  {
    name: 'password-changed',
    scope: 'global' as const,
    subject: 'Your password has been changed',
    htmlBody: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px; }
    .logo { max-height: 40px; margin-bottom: 20px; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <img src="{{logoUrl}}" alt="{{platformName}}" class="logo" />
    <h1>Password Changed</h1>
    <p>Hi {{userName}},</p>
    <p>This is a confirmation that the password for your {{platformName}} account has been successfully changed.</p>
    <p>If you didn't make this change, please contact our support team immediately:</p>
    <p style="text-align: center; margin: 20px 0;">
      <a href="mailto:{{supportEmail}}">{{supportEmail}}</a>
    </p>
    <div class="footer">
      <p>{{platformName}}</p>
    </div>
  </div>
</body>
</html>`,
    textBody: `Hi {{userName}},

This is a confirmation that the password for your {{platformName}} account has been successfully changed.

If you didn't make this change, please contact our support team immediately:
{{supportEmail}}

{{platformName}}`,
    status: 'active' as const,
    description: 'Sent when a user successfully changes their password',
  },
  {
    name: 'purchase-receipt',
    scope: 'global' as const,
    subject: 'Receipt for your purchase from {{platformName}}',
    htmlBody: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px; }
    .receipt { background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #eee; }
    .button { background-color: {{primaryColor}}; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold; }
    .logo { max-height: 40px; margin-bottom: 20px; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <img src="{{logoUrl}}" alt="{{platformName}}" class="logo" />
    <h1>Thank you for your purchase!</h1>
    <p>Hi {{userName}},</p>
    <p>Your purchase was successful. Here are your order details:</p>
    <div class="receipt">
      <p style="margin: 5px 0;"><strong>Item:</strong> {{contentTitle}}</p>
      <p style="margin: 5px 0;"><strong>Amount:</strong> {{priceFormatted}}</p>
      <p style="margin: 5px 0;"><strong>Date:</strong> {{purchaseDate}}</p>
    </div>
    <p style="text-align: center; margin: 30px 0;">
      <a href="{{contentUrl}}" class="button" style="color: white;">Access Content</a>
    </p>
    <p>If you have any questions, please contact our support team at {{supportEmail}}.</p>
    <div class="footer">
      <p>{{platformName}} - <a href="{{contactUrl}}">{{contactUrl}}</a></p>
    </div>
  </div>
</body>
</html>`,
    textBody: `Hi {{userName}},

Thank you for your purchase from {{platformName}}!

Your purchase was successful. Here are your order details:

Item: {{contentTitle}}
Amount: {{priceFormatted}}
Date: {{purchaseDate}}

Access your content here:
{{contentUrl}}

If you have any questions, please contact our support team at {{supportEmail}}.

{{platformName}}
{{contactUrl}}`,
    status: 'active' as const,
    description: 'Sent after a successful content purchase',
  },
  // ============ Commerce (P0) ============
  {
    name: 'subscription-created',
    scope: 'global' as const,
    subject: 'Subscription confirmed - {{planName}}',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}.details{background:#f9f9f9;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #eee}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Subscription Confirmed</h1><p>Hi {{userName}},</p><p>Your subscription has been set up successfully.</p><div class="details"><p style="margin:5px 0;"><strong>Plan:</strong> {{planName}}</p><p style="margin:5px 0;"><strong>Amount:</strong> {{priceFormatted}} / {{billingInterval}}</p><p style="margin:5px 0;"><strong>Next billing date:</strong> {{nextBillingDate}}</p></div><p style="text-align:center;margin:30px 0;"><a href="{{manageUrl}}" class="button" style="color:white;">Manage Subscription</a></p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `Hi {{userName}},\n\nYour subscription has been set up successfully.\n\nPlan: {{planName}}\nAmount: {{priceFormatted}} / {{billingInterval}}\nNext billing date: {{nextBillingDate}}\n\nManage your subscription: {{manageUrl}}\n\n{{platformName}}`,
    status: 'active' as const,
    description: 'Sent when a new subscription is created',
  },
  {
    name: 'subscription-renewed',
    scope: 'global' as const,
    subject: 'Subscription renewed - {{planName}}',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}.details{background:#f9f9f9;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #eee}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Subscription Renewed</h1><p>Hi {{userName}},</p><p>Your subscription has been renewed.</p><div class="details"><p style="margin:5px 0;"><strong>Plan:</strong> {{planName}}</p><p style="margin:5px 0;"><strong>Amount charged:</strong> {{priceFormatted}}</p><p style="margin:5px 0;"><strong>Billing date:</strong> {{billingDate}}</p><p style="margin:5px 0;"><strong>Next billing date:</strong> {{nextBillingDate}}</p></div><p>Manage your subscription: <a href="{{manageUrl}}">{{manageUrl}}</a></p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `Hi {{userName}},\n\nYour subscription has been renewed.\n\nPlan: {{planName}}\nAmount charged: {{priceFormatted}}\nBilling date: {{billingDate}}\nNext billing date: {{nextBillingDate}}\n\nManage your subscription: {{manageUrl}}\n\n{{platformName}}`,
    status: 'active' as const,
    description: 'Sent when a recurring subscription payment succeeds',
  },
  {
    name: 'payment-failed',
    scope: 'global' as const,
    subject: 'Payment failed - action required',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}.alert{background:#fef2f2;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #fecaca}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Payment Failed</h1><p>Hi {{userName}},</p><div class="alert"><p>We were unable to process your payment of <strong>{{priceFormatted}}</strong> for <strong>{{planName}}</strong>.</p><p>We'll retry on <strong>{{retryDate}}</strong>. Please update your payment method to avoid interruption.</p></div><p style="text-align:center;margin:30px 0;"><a href="{{updatePaymentUrl}}" class="button" style="color:white;">Update Payment Method</a></p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `Hi {{userName}},\n\nWe were unable to process your payment of {{priceFormatted}} for {{planName}}.\n\nWe'll retry on {{retryDate}}. Please update your payment method:\n{{updatePaymentUrl}}\n\n{{platformName}}`,
    status: 'active' as const,
    description: 'Sent when a subscription payment fails',
  },
  {
    name: 'subscription-cancelled',
    scope: 'global' as const,
    subject: 'Subscription cancelled - {{planName}}',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}.details{background:#f9f9f9;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #eee}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Subscription Cancelled</h1><p>Hi {{userName}},</p><p>Your subscription to <strong>{{planName}}</strong> has been cancelled.</p><div class="details"><p>You'll still have access until <strong>{{accessEndDate}}</strong>.</p></div><p>Changed your mind?</p><p style="text-align:center;margin:30px 0;"><a href="{{resubscribeUrl}}" class="button" style="color:white;">Resubscribe</a></p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `Hi {{userName}},\n\nYour subscription to {{planName}} has been cancelled.\n\nYou'll still have access until {{accessEndDate}}.\n\nChanged your mind? Resubscribe here: {{resubscribeUrl}}\n\n{{platformName}}`,
    status: 'active' as const,
    description: 'Sent when a subscription is cancelled',
  },
  {
    name: 'subscription-tier-price-change',
    scope: 'global' as const,
    subject: 'Your {{planName}} subscription price is changing',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}.details{background:#f9f9f9;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #eee}.change-row{display:flex;justify-content:space-between;margin:8px 0}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Subscription Price Update</h1><p>Hi {{userName}},</p><p>We're writing to let you know that the price of your <strong>{{planName}}</strong> subscription is changing from <strong>{{effectiveDate}}</strong>.</p><div class="details"><p style="margin:5px 0;"><strong>Current price:</strong> {{oldPriceFormatted}} / {{billingInterval}}</p><p style="margin:5px 0;"><strong>New price:</strong> {{newPriceFormatted}} / {{billingInterval}}</p><p style="margin:5px 0;"><strong>Effective from:</strong> {{effectiveDate}}</p></div><p>No action is needed if you're happy to continue — your subscription renews at the new price from {{effectiveDate}}. Renewals before then stay at your current price.</p><p>If you'd prefer not to continue at the new price, you can cancel any time before <strong>{{effectiveDate}}</strong> from your subscription management page.</p><p style="text-align:center;margin:30px 0;"><a href="{{manageUrl}}" class="button" style="color:white;">Manage Subscription</a></p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `Hi {{userName}},\n\nWe're writing to let you know that the price of your {{planName}} subscription is changing from {{effectiveDate}}.\n\nCurrent price: {{oldPriceFormatted}} / {{billingInterval}}\nNew price: {{newPriceFormatted}} / {{billingInterval}}\nEffective from: {{effectiveDate}}\n\nNo action is needed if you're happy to continue — your subscription renews at the new price from {{effectiveDate}}. Renewals before then stay at your current price.\n\nIf you'd prefer not to continue at the new price, you can cancel any time before {{effectiveDate}} from your subscription management page:\n{{manageUrl}}\n\n{{platformName}}`,
    status: 'active' as const,
    description:
      'Sent to each subscriber on the changed interval when a tier or course-plan price is changed in Studio. The effective date is their first renewal at least 30 days after this email (Codex-2hxff.3). Explains old → new price and how to cancel before it takes effect.',
  },
  {
    name: 'refund-processed',
    scope: 'global' as const,
    subject: 'Refund processed - {{platformName}}',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}.details{background:#f9f9f9;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #eee}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Refund Processed</h1><p>Hi {{userName}},</p><p>Your refund has been processed. {{accessNote}}</p><div class="details"><p style="margin:5px 0;"><strong>Item:</strong> {{contentTitle}}</p><p style="margin:5px 0;"><strong>Refund amount:</strong> {{refundAmount}}</p><p style="margin:5px 0;"><strong>Original amount:</strong> {{originalAmount}}</p><p style="margin:5px 0;"><strong>Refund date:</strong> {{refundDate}}</p></div><p>The refund should appear on your statement within 5-10 business days.</p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `Hi {{userName}},\n\nYour refund has been processed. {{accessNote}}\n\nItem: {{contentTitle}}\nRefund amount: {{refundAmount}}\nOriginal amount: {{originalAmount}}\nRefund date: {{refundDate}}\n\nThe refund should appear on your statement within 5-10 business days.\n\n{{platformName}}`,
    status: 'active' as const,
    description: 'Sent when a refund is processed',
  },
  // ============ Organization (P1) ============
  {
    name: 'org-member-invitation',
    scope: 'global' as const,
    subject: "You've been added to {{orgName}}",
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>You've been added to {{orgName}}</h1><p><strong>{{inviterName}}</strong> has added you to <strong>{{orgName}}</strong> as <strong>{{roleLabel}}</strong>.</p><p style="text-align:center;margin:30px 0;"><a href="{{orgUrl}}" class="button" style="color:white;">Open {{orgName}}</a></p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `{{inviterName}} has added you to {{orgName}} as {{roleLabel}}.\n\nOpen {{orgName}}: {{orgUrl}}\n\n{{platformName}}`,
    status: 'active' as const,
    description:
      'Sent when someone is added to an organization. Adding makes them a member at once, so there is nothing to accept: the button opens the org Studio for an admin or creator, or the org home page for a member (Codex-bnxhw).',
  },
  {
    name: 'member-role-changed',
    scope: 'global' as const,
    subject: 'Your role in {{orgName}} has changed',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Role Updated</h1><p>Hi {{userName}},</p><p>Your role in <strong>{{orgName}}</strong> has been changed from <strong>{{oldRole}}</strong> to <strong>{{newRole}}</strong>.</p><p>If you have questions about this change, please contact your organisation admin.</p><div class="footer"><p>{{platformName}}</p></div></div></body></html>`,
    textBody: `Hi {{userName}},\n\nYour role in {{orgName}} has been changed from {{oldRole}} to {{newRole}}.\n\nIf you have questions about this change, please contact your organisation admin.\n\n{{platformName}}`,
    status: 'active' as const,
    description: 'Sent when a member role is updated in an organization',
  },
  {
    name: 'member-removed',
    scope: 'global' as const,
    subject: "You've been removed from {{orgName}}",
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Membership Removed</h1><p>Hi {{userName}},</p><p>You have been removed from <strong>{{orgName}}</strong>.</p><p>If you believe this was a mistake, please contact the organisation admin.</p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `Hi {{userName}},\n\nYou have been removed from {{orgName}}.\n\nIf you believe this was a mistake, please contact the organisation admin.\n\n{{platformName}}`,
    status: 'active' as const,
    description: 'Sent when a member is removed from an organization',
  },
  // ============ Auth (P1) ============
  {
    name: 'welcome',
    scope: 'global' as const,
    subject: 'Welcome to {{platformName}}',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Welcome!</h1><p>Hi {{userName}},</p><p>Welcome to {{platformName}}! Your email has been verified and your account is ready.</p><p style="text-align:center;margin:30px 0;"><a href="{{exploreUrl}}" class="button" style="color:white;">Start Exploring</a></p><p>You can also <a href="{{loginUrl}}">sign in here</a> at any time.</p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `Hi {{userName}},\n\nWelcome to {{platformName}}! Your email has been verified and your account is ready.\n\nStart exploring: {{exploreUrl}}\nSign in: {{loginUrl}}\n\n{{platformName}}`,
    status: 'active' as const,
    description: 'Sent after email verification to welcome a new user',
  },
  // ============ Media (P2) ============
  {
    name: 'transcoding-complete',
    scope: 'global' as const,
    subject: 'Your video is ready - {{contentTitle}}',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Video Ready</h1><p>Hi {{userName}},</p><p>Your video <strong>{{contentTitle}}</strong> has finished processing and is ready to publish.</p><p>Duration: {{duration}}</p><p style="text-align:center;margin:30px 0;"><a href="{{contentUrl}}" class="button" style="color:white;">View Content</a></p><div class="footer"><p>{{platformName}}</p></div></div></body></html>`,
    textBody: `Hi {{userName}},\n\nYour video "{{contentTitle}}" has finished processing and is ready to publish.\n\nDuration: {{duration}}\n\nView it here: {{contentUrl}}\n\n{{platformName}}`,
    status: 'active' as const,
    description:
      'Sent to creator when video transcoding completes successfully',
  },
  {
    name: 'transcoding-failed',
    scope: 'global' as const,
    subject: 'Transcoding failed - {{contentTitle}}',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}.alert{background:#fef2f2;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #fecaca}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Transcoding Failed</h1><p>Hi {{userName}},</p><p>Unfortunately, processing your video <strong>{{contentTitle}}</strong> failed.</p><div class="alert"><p>{{errorSummary}}</p></div><p style="text-align:center;margin:30px 0;"><a href="{{retryUrl}}" class="button" style="color:white;">Retry Upload</a></p><p>If the problem persists, please contact support at {{supportEmail}}.</p><div class="footer"><p>{{platformName}}</p></div></div></body></html>`,
    textBody: `Hi {{userName}},\n\nUnfortunately, processing your video "{{contentTitle}}" failed.\n\nError: {{errorSummary}}\n\nRetry here: {{retryUrl}}\n\nIf the problem persists, please contact support at {{supportEmail}}.\n\n{{platformName}}`,
    status: 'active' as const,
    description: 'Sent to creator when video transcoding fails',
  },
  {
    name: 'transcoding-owner-alert',
    scope: 'global' as const,
    subject: '[Transcoding] {{headline}}',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}.details{background:#f6f6f6;padding:16px;border-radius:6px;white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>{{headline}}</h1><p>{{summary}}</p><pre class="details">{{details}}</pre><div class="footer"><p>{{platformName}}</p></div></div></body></html>`,
    textBody: `{{headline}}\n\n{{summary}}\n\n{{details}}\n\n{{platformName}}`,
    status: 'active' as const,
    description:
      'Sent to the platform support mailbox when a transcode fails for good, or a setup fault stops every upload (Codex-l2c48.6, .10)',
  },
  // ============ Creator (P2) ============
  {
    name: 'new-sale',
    scope: 'global' as const,
    subject: 'New sale: {{contentTitle}}',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}.details{background:#f0fdf4;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #bbf7d0}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>New Sale!</h1><p>Hi {{creatorName}},</p><div class="details"><p style="margin:5px 0;"><strong>Content:</strong> {{contentTitle}}</p><p style="margin:5px 0;"><strong>Your earnings:</strong> {{saleAmount}}</p><p style="margin:5px 0;"><strong>Buyer:</strong> {{buyerName}}</p></div><p style="text-align:center;margin:30px 0;"><a href="{{dashboardUrl}}" class="button" style="color:white;">View Dashboard</a></p><div class="footer"><p>{{platformName}}</p></div></div></body></html>`,
    textBody: `Hi {{creatorName}},\n\nYou made a sale!\n\nContent: {{contentTitle}}\nYour earnings: {{saleAmount}}\nBuyer: {{buyerName}}\n\nView your dashboard: {{dashboardUrl}}\n\n{{platformName}}`,
    status: 'active' as const,
    description: 'Sent to creator when someone purchases their content',
  },
  {
    name: 'connect-account-status',
    scope: 'global' as const,
    subject: 'Stripe account update - {{accountStatus}}',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Account Update</h1><p>Hi {{creatorName}},</p><p>Your Stripe Connect account status: <strong>{{accountStatus}}</strong></p><p>{{actionRequired}}</p><p style="text-align:center;margin:30px 0;"><a href="{{dashboardUrl}}" class="button" style="color:white;">View Dashboard</a></p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `Hi {{creatorName}},\n\nYour Stripe Connect account status: {{accountStatus}}\n\n{{actionRequired}}\n\nView your dashboard: {{dashboardUrl}}\n\n{{platformName}}`,
    status: 'active' as const,
    description:
      'Sent to creator when their Stripe Connect account status changes',
  },
  // ============ Payout Notifications (WP-10 — Codex-69t7c.10) ============
  {
    name: 'creator-connect-needed',
    scope: 'global' as const,
    subject:
      'Action required: connect Stripe to receive your payout of {{amountFormatted}}',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}.details{background:#fefce8;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #fef08a}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Connect Stripe to receive your payout</h1><p>Hi {{creatorName}},</p><p>A payout of <strong>{{amountFormatted}}</strong> is waiting for you, but you haven't connected a Stripe account yet.</p><div class="details"><p style="margin:5px 0;">Your earnings are held safely and will be released the moment you connect your Stripe account and it is approved.</p></div><p>Connect your Stripe account from your Earnings dashboard to receive this payout.</p><p style="text-align:center;margin:30px 0;"><a href="{{dashboardUrl}}" class="button" style="color:white;">Connect Stripe Account</a></p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `Hi {{creatorName}},\n\nA payout of {{amountFormatted}} is waiting for you, but you haven't connected a Stripe account yet.\n\nYour earnings are held safely and will be released the moment you connect your Stripe account and it is approved.\n\nConnect your Stripe account from your Earnings dashboard:\n{{dashboardUrl}}\n\n{{platformName}}`,
    status: 'active' as const,
    description:
      'Sent to a creator when a payout is parked as pending because they have no Connect account (WP-10).',
  },
  {
    name: 'payout-released',
    scope: 'global' as const,
    subject: 'Your payout of {{amountFormatted}} is on its way',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}.details{background:#f0fdf4;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #bbf7d0}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Your payout is on its way!</h1><p>Hi {{creatorName}},</p><p>Great news — your pending earnings have been transferred to your Stripe account.</p><div class="details"><p style="margin:5px 0;"><strong>Total transferred:</strong> {{amountFormatted}}</p><p style="margin:5px 0;"><strong>Payouts released:</strong> {{payoutCount}}</p></div><p>Funds typically appear in your bank account within 2 business days depending on your Stripe payout schedule.</p><p style="text-align:center;margin:30px 0;"><a href="{{dashboardUrl}}" class="button" style="color:white;">View Earnings</a></p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `Hi {{creatorName}},\n\nGreat news — your pending earnings have been transferred to your Stripe account.\n\nTotal transferred: {{amountFormatted}}\nPayouts released: {{payoutCount}}\n\nFunds typically appear in your bank account within 2 business days depending on your Stripe payout schedule.\n\nView your earnings:\n{{dashboardUrl}}\n\n{{platformName}}`,
    status: 'active' as const,
    description:
      'Sent to a creator when pending payouts transition to paid after Connect activation (WP-10).',
  },
  // ============ Engagement (P3) ============
  {
    name: 'new-content-published',
    scope: 'global' as const,
    subject: 'New release: {{contentTitle}} by {{creatorName}}',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>New Content Available</h1><p>Hi {{userName}},</p><p><strong>{{creatorName}}</strong> just published new content:</p><h2 style="color:{{primaryColor}};">{{contentTitle}}</h2><p>{{contentDescription}}</p><p style="text-align:center;margin:30px 0;"><a href="{{contentUrl}}" class="button" style="color:white;">Watch Now</a></p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p><p style="font-size:11px;"><a href="{{unsubscribeUrl}}">Unsubscribe</a></p></div></div></body></html>`,
    textBody: `Hi {{userName}},\n\n{{creatorName}} just published new content:\n\n{{contentTitle}}\n{{contentDescription}}\n\nWatch now: {{contentUrl}}\n\n{{platformName}}\nUnsubscribe: {{unsubscribeUrl}}`,
    status: 'active' as const,
    description: 'Sent to subscribers when new content is published',
  },
  {
    name: 'weekly-digest',
    scope: 'global' as const,
    subject: 'Your weekly roundup from {{platformName}}',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Weekly Roundup</h1><p>Hi {{userName}},</p><p>Here's what's new this week — <strong>{{newContentCount}}</strong> new items:</p><div style="margin:20px 0;">{{topContent}}</div><p style="text-align:center;margin:30px 0;"><a href="{{platformUrl}}" class="button" style="color:white;">Explore More</a></p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p><p style="font-size:11px;"><a href="{{unsubscribeUrl}}">Unsubscribe</a> · <a href="{{preferencesUrl}}">Email preferences</a></p></div></div></body></html>`,
    textBody: `Hi {{userName}},\n\nHere's what's new this week — {{newContentCount}} new items:\n\n{{topContent}}\n\nExplore more: {{platformUrl}}\n\n{{platformName}}\nUnsubscribe: {{unsubscribeUrl}}`,
    status: 'active' as const,
    description: 'Weekly digest of new content sent to opted-in users',
  },
  // ============ Revenue-Share Agreements (WP-5 — Codex-90de9) ============
  //
  // All copy explicitly says "post-platform" when referencing share. This
  // aligns with the agreement-math semantic (creator share is a fraction
  // of the pool that remains AFTER the platform fee is removed, not the
  // gross). Misleading copy like "30% of every sale" would be wrong per
  // the C1 math fix in PR #213.
  {
    name: 'agreement-proposed-by-owner',
    scope: 'global' as const,
    subject: '{{orgName}} proposed a revenue-share agreement',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}.details{background:#f9f9f9;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #eee}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Revenue-share proposal from {{orgName}}</h1><p>Hi {{recipientName}},</p><p><strong>{{otherPartyName}}</strong> at <strong>{{orgName}}</strong> has proposed a revenue-share agreement with you.</p><div class="details"><p style="margin:5px 0;"><strong>Your share:</strong> {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue</p><p style="margin:5px 0;"><strong>Term:</strong> {{termMonthsDisplay}}</p><p style="margin:5px 0;"><em>Note:</em> {{note}}</p></div><p>The platform fee is taken from gross revenue first; your share is calculated on what remains.</p><p style="text-align:center;margin:30px 0;"><a href="{{deepLinkUrl}}" class="button" style="color:white;">Review proposal</a></p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `Hi {{recipientName}},\n\n{{otherPartyName}} at {{orgName}} has proposed a revenue-share agreement with you.\n\nYour share: {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue\nTerm: {{termMonthsDisplay}}\nNote: {{note}}\n\nThe platform fee is taken from gross revenue first; your share is calculated on what remains.\n\nReview the proposal: {{deepLinkUrl}}\n\n{{platformName}}`,
    status: 'active' as const,
    description:
      'Sent to a creator when the org owner opens a revenue-share negotiation (WP-5).',
  },
  {
    name: 'agreement-countered-by-creator',
    scope: 'global' as const,
    subject: '{{otherPartyName}} countered your revenue-share proposal',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}.details{background:#f9f9f9;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #eee}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Counter-proposal received</h1><p>Hi {{recipientName}},</p><p><strong>{{otherPartyName}}</strong> has countered your revenue-share proposal for <strong>{{orgName}}</strong>.</p><div class="details"><p style="margin:5px 0;"><strong>Their counter:</strong> {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue</p><p style="margin:5px 0;"><strong>Term:</strong> {{termMonthsDisplay}}</p><p style="margin:5px 0;"><em>Note:</em> {{note}}</p></div><p>You can accept, decline, or counter again from the negotiation page.</p><p style="text-align:center;margin:30px 0;"><a href="{{deepLinkUrl}}" class="button" style="color:white;">Review counter</a></p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `Hi {{recipientName}},\n\n{{otherPartyName}} has countered your revenue-share proposal for {{orgName}}.\n\nTheir counter: {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue\nTerm: {{termMonthsDisplay}}\nNote: {{note}}\n\nYou can accept, decline, or counter again from the negotiation page:\n{{deepLinkUrl}}\n\n{{platformName}}`,
    status: 'active' as const,
    description:
      'Sent to the org owner when a creator counters their revenue-share proposal (WP-5).',
  },
  {
    name: 'agreement-countered-by-owner',
    scope: 'global' as const,
    subject: '{{orgName}} countered your revenue-share proposal',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}.details{background:#f9f9f9;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #eee}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Counter-proposal received</h1><p>Hi {{recipientName}},</p><p><strong>{{otherPartyName}}</strong> at <strong>{{orgName}}</strong> has countered your revenue-share proposal.</p><div class="details"><p style="margin:5px 0;"><strong>Their counter:</strong> {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue</p><p style="margin:5px 0;"><strong>Term:</strong> {{termMonthsDisplay}}</p><p style="margin:5px 0;"><em>Note:</em> {{note}}</p></div><p>You can accept, decline, or counter again from the negotiation page.</p><p style="text-align:center;margin:30px 0;"><a href="{{deepLinkUrl}}" class="button" style="color:white;">Review counter</a></p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `Hi {{recipientName}},\n\n{{otherPartyName}} at {{orgName}} has countered your revenue-share proposal.\n\nTheir counter: {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue\nTerm: {{termMonthsDisplay}}\nNote: {{note}}\n\nYou can accept, decline, or counter again from the negotiation page:\n{{deepLinkUrl}}\n\n{{platformName}}`,
    status: 'active' as const,
    description:
      'Sent to the creator when the org owner counters their revenue-share proposal (WP-5).',
  },
  {
    name: 'agreement-accepted',
    scope: 'global' as const,
    subject: 'Revenue-share agreement with {{orgName}} is now active',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}.details{background:#f0fdf4;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #bbf7d0}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Agreement active</h1><p>Hi {{recipientName}},</p><p>Your revenue-share agreement with <strong>{{orgName}}</strong> has been accepted and is now active.</p><div class="details"><p style="margin:5px 0;"><strong>Counterparty:</strong> {{otherPartyName}}</p><p style="margin:5px 0;"><strong>Share:</strong> {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue</p><p style="margin:5px 0;"><strong>Term:</strong> {{termMonthsDisplay}}</p><p style="margin:5px 0;"><strong>Effective from:</strong> {{effectiveFromDate}}</p></div><p>Payouts under this agreement begin with the next qualifying invoice. The platform fee is taken from gross revenue first; your share is calculated on what remains.</p><p style="text-align:center;margin:30px 0;"><a href="{{deepLinkUrl}}" class="button" style="color:white;">View agreement</a></p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `Hi {{recipientName}},\n\nYour revenue-share agreement with {{orgName}} has been accepted and is now active.\n\nCounterparty: {{otherPartyName}}\nShare: {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue\nTerm: {{termMonthsDisplay}}\nEffective from: {{effectiveFromDate}}\n\nPayouts under this agreement begin with the next qualifying invoice. The platform fee is taken from gross revenue first; your share is calculated on what remains.\n\nView agreement: {{deepLinkUrl}}\n\n{{platformName}}`,
    status: 'active' as const,
    description:
      'Sent to both parties when a revenue-share proposal is accepted (WP-5).',
  },
  {
    name: 'agreement-declined',
    scope: 'global' as const,
    subject: 'Revenue-share proposal with {{orgName}} declined',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}.details{background:#f9f9f9;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #eee}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Proposal declined</h1><p>Hi {{recipientName}},</p><p>The revenue-share proposal between you and <strong>{{otherPartyName}}</strong> at <strong>{{orgName}}</strong> has been declined.</p><div class="details"><p style="margin:5px 0;"><strong>Proposed share:</strong> {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue</p><p style="margin:5px 0;"><strong>Term:</strong> {{termMonthsDisplay}}</p><p style="margin:5px 0;"><em>Reason given:</em> {{declineReason}}</p></div><p>You can open a fresh proposal at any time from the negotiation page.</p><p style="text-align:center;margin:30px 0;"><a href="{{deepLinkUrl}}" class="button" style="color:white;">Open new proposal</a></p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `Hi {{recipientName}},\n\nThe revenue-share proposal between you and {{otherPartyName}} at {{orgName}} has been declined.\n\nProposed share: {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue\nTerm: {{termMonthsDisplay}}\nReason given: {{declineReason}}\n\nYou can open a fresh proposal at any time from the negotiation page:\n{{deepLinkUrl}}\n\n{{platformName}}`,
    status: 'active' as const,
    description:
      'Sent to both parties when a revenue-share proposal is declined (WP-5).',
  },
  {
    name: 'agreement-terminated',
    scope: 'global' as const,
    subject: 'Revenue-share agreement with {{orgName}} terminated',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}.details{background:#fef2f2;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #fecaca}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Agreement terminated</h1><p>Hi {{recipientName}},</p><p>Your revenue-share agreement with <strong>{{orgName}}</strong> (counterparty <strong>{{otherPartyName}}</strong>) has been terminated.</p><div class="details"><p style="margin:5px 0;"><strong>Previous share:</strong> {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue</p><p style="margin:5px 0;"><strong>Original term:</strong> {{termMonthsDisplay}}</p><p style="margin:5px 0;"><strong>Effective termination:</strong> {{effectiveTerminationDate}}</p><p style="margin:5px 0;"><em>Reason given:</em> {{terminationReason}}</p></div><p>Termination takes effect immediately. Per the revenue-share policy, you receive your full share for any invoice fired before today; no further shares accrue from {{effectiveTerminationDate}} onwards.</p><p style="text-align:center;margin:30px 0;"><a href="{{deepLinkUrl}}" class="button" style="color:white;">View agreement history</a></p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `Hi {{recipientName}},\n\nYour revenue-share agreement with {{orgName}} (counterparty {{otherPartyName}}) has been terminated.\n\nPrevious share: {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue\nOriginal term: {{termMonthsDisplay}}\nEffective termination: {{effectiveTerminationDate}}\nReason given: {{terminationReason}}\n\nTermination takes effect immediately. Per the revenue-share policy, you receive your full share for any invoice fired before today; no further shares accrue from {{effectiveTerminationDate}} onwards.\n\nView agreement history: {{deepLinkUrl}}\n\n{{platformName}}`,
    status: 'active' as const,
    description:
      'Sent to the non-terminating party when a revenue-share agreement is terminated. Includes Decision Q3 (no pro-rating, active-as-of-invoice-date) explainer (WP-5).',
  },
  {
    name: 'agreement-expiring-soon',
    scope: 'global' as const,
    subject: 'Time to review your revenue-share agreement with {{orgName}}',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}.details{background:#fef9c3;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #fde68a}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Agreement review due</h1><p>Hi {{recipientName}},</p><p>Your revenue-share agreement with <strong>{{orgName}}</strong> (counterparty <strong>{{otherPartyName}}</strong>) reaches its review date soon.</p><div class="details"><p style="margin:5px 0;"><strong>Current share:</strong> {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue</p><p style="margin:5px 0;"><strong>Original term:</strong> {{termMonthsDisplay}}</p><p style="margin:5px 0;"><strong>Review by:</strong> {{expiryDate}}</p></div><p>Nothing changes on that date: the agreement keeps paying until either of you ends it, or a new agreement replaces it. To agree different terms, open a new proposal.</p><p style="text-align:center;margin:30px 0;"><a href="{{deepLinkUrl}}" class="button" style="color:white;">Open new proposal</a></p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `Hi {{recipientName}},\n\nYour revenue-share agreement with {{orgName}} (counterparty {{otherPartyName}}) reaches its review date soon.\n\nCurrent share: {{sharePercentDisplay}} of post-platform {{revenueTypeLabel}} revenue\nOriginal term: {{termMonthsDisplay}}\nReview by: {{expiryDate}}\n\nNothing changes on that date: the agreement keeps paying until either of you ends it, or a new agreement replaces it. To agree different terms, open a new proposal.\n\nOpen new proposal: {{deepLinkUrl}}\n\n{{platformName}}`,
    status: 'active' as const,
    description:
      "Sent to both parties 30 days before the agreement's review date. The review date is not an expiry: the agreement keeps paying (owner decision AGR-01; migration 0106 rewords existing rows).",
  },
  // ============ Removal from an organisation (Codex-2hxff.64) ============
  {
    name: 'removed-from-organisation',
    scope: 'global' as const,
    subject: "You've been removed from {{orgName}}",
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}.details{background:#f8fafc;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #e2e8f0}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>You've been removed from {{orgName}}</h1><p>Hi {{recipientName}},</p><p>You are no longer a member of <strong>{{orgName}}</strong> as of {{removedOn}}. This is what that ended:</p><div class="details"><p style="margin:5px 0;"><strong>Revenue-share agreements ended:</strong> {{agreementsEnded}}</p><p style="margin:5px 0;"><strong>Items taken off sale:</strong> {{contentOffSale}}</p><p style="margin:5px 0;"><strong>Courses taken off sale:</strong> {{coursesOffSale}}</p><p style="margin:5px 0;"><strong>Course subscriptions ending at their period end:</strong> {{courseSubscriptionsEnding}}</p></div><p>Money you earned before {{removedOn}} is still paid to you. People who already bought your work keep it.</p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `Hi {{recipientName}},\n\nYou are no longer a member of {{orgName}} as of {{removedOn}}. This is what that ended:\n\nRevenue-share agreements ended: {{agreementsEnded}}\nItems taken off sale: {{contentOffSale}}\nCourses taken off sale: {{coursesOffSale}}\nCourse subscriptions ending at their period end: {{courseSubscriptionsEnding}}\n\nMoney you earned before {{removedOn}} is still paid to you. People who already bought your work keep it.\n\n{{platformName}}`,
    status: 'active' as const,
    description:
      'Sent to a creator removed from an organisation, listing what the removal ended (Codex-2hxff.64, owner decision Q5). Replaces the agreement-terminated email on removal.',
  },
  {
    name: 'course-no-longer-offered',
    scope: 'global' as const,
    subject: '{{courseTitle}} is no longer offered',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}.details{background:#f8fafc;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #e2e8f0}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>{{courseTitle}} is no longer offered</h1><p>Hi {{userName}},</p><p><strong>{{courseTitle}}</strong> is no longer offered by <strong>{{orgName}}</strong>, so your subscription to it will end.</p><div class="details"><p style="margin:5px 0;"><strong>You keep access until:</strong> {{accessUntil}}</p><p style="margin:5px 0;">You won't be charged for it again.</p></div><p style="text-align:center;margin:30px 0;"><a href="{{manageUrl}}" class="button" style="color:white;">Manage subscriptions</a></p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `Hi {{userName}},\n\n{{courseTitle}} is no longer offered by {{orgName}}, so your subscription to it will end.\n\nYou keep access until: {{accessUntil}}\nYou won't be charged for it again.\n\nManage subscriptions: {{manageUrl}}\n\n{{platformName}}`,
    status: 'active' as const,
    description:
      'Sent to each course subscriber when the course is taken off sale because its creator left the organisation; the subscription cancels at period end (Codex-2hxff.64, owner decision D4).',
  },
  // ============ Ownership transfer (Codex-2hxff.2) ============
  //
  // Copy is the owner-reviewed mockup's state 10.
  {
    name: 'ownership-offered',
    scope: 'global' as const,
    subject: '{{offeredByName}} has offered you ownership of {{orgName}}',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Ownership offer</h1><p>Hi {{recipientName}},</p><p>{{offeredByName}} would like you to become the owner of <strong>{{orgName}}</strong>. As owner you'd receive the organisation's share of every sale, and you'd be the only person who can transfer it.</p><p>The offer is open until <strong>{{expiresAtDisplay}}</strong>.</p><p style="text-align:center;margin:30px 0;"><a href="{{deepLinkUrl}}" class="button" style="color:white;">Review the offer</a></p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `Hi {{recipientName}},\n\n{{offeredByName}} would like you to become the owner of {{orgName}}. As owner you'd receive the organisation's share of every sale, and you'd be the only person who can transfer it.\n\nThe offer is open until {{expiresAtDisplay}}.\n\nReview the offer: {{deepLinkUrl}}\n\n{{platformName}}`,
    status: 'active' as const,
    description:
      "Sent to the recipient when an organisation's owner offers them ownership (Codex-2hxff.2).",
  },
  {
    name: 'ownership-transferred',
    scope: 'global' as const,
    subject: '{{newOwnerName}} is now the owner of {{orgName}}',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>New owner</h1><p>Ownership of <strong>{{orgName}}</strong> moved from {{previousOwnerName}} to {{newOwnerName}} on {{transferredAtDisplay}}.</p><p>From that moment the organisation's share of sales goes to {{newOwnerName}}. Money earned before stays with {{previousOwnerName}}. {{previousOwnerName}} is now an admin.</p><p style="text-align:center;margin:30px 0;"><a href="{{deepLinkUrl}}" class="button" style="color:white;">Open Studio</a></p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `Ownership of {{orgName}} moved from {{previousOwnerName}} to {{newOwnerName}} on {{transferredAtDisplay}}.\n\nFrom that moment the organisation's share of sales goes to {{newOwnerName}}. Money earned before stays with {{previousOwnerName}}. {{previousOwnerName}} is now an admin.\n\nOpen Studio: {{deepLinkUrl}}\n\n{{platformName}}`,
    status: 'active' as const,
    description:
      'Sent to the new owner, the previous owner and every other active admin when ownership moves, by acceptance or support reassignment (Codex-2hxff.2).',
  },
  {
    name: 'ownership-offer-closed',
    scope: 'global' as const,
    subject: 'Your ownership offer to {{recipientName}} was {{outcome}}',
    htmlBody: `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Ownership offer {{outcome}}</h1><p>Hi {{ownerName}},</p><p>{{outcomeSentence}} Nothing has changed, and you can offer ownership to someone else from Settings.</p><p style="text-align:center;margin:30px 0;"><a href="{{deepLinkUrl}}" class="button" style="color:white;">Open Settings</a></p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>`,
    textBody: `Hi {{ownerName}},\n\n{{outcomeSentence}} Nothing has changed, and you can offer ownership to someone else from Settings.\n\nOpen Settings: {{deepLinkUrl}}\n\n{{platformName}}`,
    status: 'active' as const,
    description:
      'Sent to the owner when their ownership offer is declined, or withdrawn because the recipient is no longer an admin or creator. An expired offer sends no email (Codex-2hxff.2).',
  },
];

export async function seedTemplates() {
  console.log('🌱 Seeding email templates...');

  try {
    await dbWs.transaction(async (tx) => {
      for (const template of globalTemplates) {
        const existing = await tx.query.emailTemplates.findFirst({
          where: and(
            eq(schema.emailTemplates.name, template.name),
            eq(schema.emailTemplates.scope, 'global')
          ),
        });

        if (existing) {
          console.log(`  ⏭️  Skipping ${template.name} (already exists)`);
          continue;
        }

        await tx.insert(schema.emailTemplates).values({
          ...template,
          organizationId: null,
          creatorId: null,
        });
        console.log(`  ✅ Created ${template.name}`);
      }
    });

    console.log('✨ Seed complete!');
  } catch (error) {
    // Transaction will automatically rollback on error
    // All template insertions will be reverted to maintain data consistency
    console.error('Seed failed - rolling back transaction:', error);
    throw error;
  }
}

// Run directly when executed as a standalone script
if (process.argv[1] === __filename) {
  seedTemplates()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed process failed:', err);
      process.exit(1);
    });
}
