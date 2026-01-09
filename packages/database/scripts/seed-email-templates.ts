import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { and, eq } from 'drizzle-orm';
import { dbWs, schema } from '../src';

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env.dev
config({ path: path.resolve(__dirname, '../../../.env.dev') });

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
      <p style="margin: 5px 0;"><strong>Amount:</strong> \${{priceFormatted}}</p>
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
Amount: \${{priceFormatted}}
Date: {{purchaseDate}}

Access your content here:
{{contentUrl}}

If you have any questions, please contact our support team at {{supportEmail}}.

{{platformName}}
{{contactUrl}}`,
    status: 'active' as const,
    description: 'Sent after a successful content purchase',
  },
];

async function seedTemplates() {
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

seedTemplates()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed process failed:', err);
    process.exit(1);
  });
