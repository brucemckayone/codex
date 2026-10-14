import { getOrgLogoKey } from '../../../transcoding/src/paths';
import type { dbWs as DbClient } from '../../src';
import { schema } from '../../src';
import { MEMBERSHIPS, ORGS, SETTINGS, USERS } from './constants';

const now = new Date();

export async function seedOrganizations(db: typeof DbClient) {
  // Organizations
  await db.insert(schema.organizations).values([
    {
      id: ORGS.alpha.id,
      name: ORGS.alpha.name,
      slug: ORGS.alpha.slug,
      description: ORGS.alpha.description,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: ORGS.beta.id,
      name: ORGS.beta.name,
      slug: ORGS.beta.slug,
      description: ORGS.beta.description,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: ORGS.bones.id,
      name: ORGS.bones.name,
      slug: ORGS.bones.slug,
      description: ORGS.bones.description,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  // Organization memberships
  await db.insert(schema.organizationMemberships).values([
    {
      id: MEMBERSHIPS.creatorAlphaOwner.id,
      organizationId: ORGS.alpha.id,
      userId: USERS.creator.id,
      role: 'owner',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: MEMBERSHIPS.viewerAlphaSubscriber.id,
      organizationId: ORGS.alpha.id,
      userId: USERS.viewer.id,
      role: 'subscriber',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: MEMBERSHIPS.viewer2AlphaSubscriber.id,
      organizationId: ORGS.alpha.id,
      userId: USERS.viewer2.id,
      role: 'subscriber',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: MEMBERSHIPS.adminBetaOwner.id,
      organizationId: ORGS.beta.id,
      userId: USERS.admin.id,
      role: 'owner',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: MEMBERSHIPS.viewerBetaSubscriber.id,
      organizationId: ORGS.beta.id,
      userId: USERS.viewer.id,
      role: 'subscriber',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: MEMBERSHIPS.adminAlphaAdmin.id,
      organizationId: ORGS.alpha.id,
      userId: USERS.admin.id,
      role: 'admin',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: MEMBERSHIPS.creatorBetaCreator.id,
      organizationId: ORGS.beta.id,
      userId: USERS.creator.id,
      role: 'creator',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    // Customer memberships for Studio Alpha
    {
      id: MEMBERSHIPS.customer1AlphaMember.id,
      organizationId: ORGS.alpha.id,
      userId: USERS.customer1.id,
      role: 'member',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: MEMBERSHIPS.customer2AlphaMember.id,
      organizationId: ORGS.alpha.id,
      userId: USERS.customer2.id,
      role: 'member',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: MEMBERSHIPS.customer3AlphaMember.id,
      organizationId: ORGS.alpha.id,
      userId: USERS.customer3.id,
      role: 'member',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: MEMBERSHIPS.customer4AlphaMember.id,
      organizationId: ORGS.alpha.id,
      userId: USERS.customer4.id,
      role: 'member',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: MEMBERSHIPS.customer5AlphaMember.id,
      organizationId: ORGS.alpha.id,
      userId: USERS.customer5.id,
      role: 'member',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    // Of Blood & Bones memberships
    {
      id: MEMBERSHIPS.luzuraBonesOwner.id,
      organizationId: ORGS.bones.id,
      userId: USERS.luzura.id,
      role: 'owner',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: MEMBERSHIPS.viewerBonesMember.id,
      organizationId: ORGS.bones.id,
      userId: USERS.viewer.id,
      role: 'member',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
  ]);

  // Ownership periods — who is paid as each org's owner, from when
  // (Codex-2hxff.2). Production writes one with every owner membership; the
  // seed does too, so local payouts resolve exactly as they do there.
  await db.insert(schema.organizationOwnershipPeriods).values([
    {
      organizationId: ORGS.alpha.id,
      userId: USERS.creator.id,
      startedAt: now,
      source: 'created',
    },
    {
      organizationId: ORGS.beta.id,
      userId: USERS.admin.id,
      startedAt: now,
      source: 'created',
    },
    {
      organizationId: ORGS.bones.id,
      userId: USERS.luzura.id,
      startedAt: now,
      source: 'created',
    },
  ]);

  // Organization followers (audience relationships — separate from team memberships)
  await db.insert(schema.organizationFollowers).values([
    {
      organizationId: ORGS.alpha.id,
      userId: USERS.viewer.id,
      createdAt: now,
    },
    {
      organizationId: ORGS.beta.id,
      userId: USERS.viewer.id,
      createdAt: now,
    },
    {
      organizationId: ORGS.alpha.id,
      userId: USERS.customer1.id,
      createdAt: now,
    },
    {
      organizationId: ORGS.alpha.id,
      userId: USERS.customer2.id,
      createdAt: now,
    },
    // Of Blood & Bones followers
    {
      organizationId: ORGS.bones.id,
      userId: USERS.viewer.id,
      createdAt: now,
    },
    {
      organizationId: ORGS.bones.id,
      userId: USERS.customer3.id,
      createdAt: now,
    },
  ]);

  // Platform settings hub (required FK target for spoke tables)
  await db.insert(schema.platformSettings).values([
    { organizationId: ORGS.alpha.id, createdAt: now, updatedAt: now },
    { organizationId: ORGS.beta.id, createdAt: now, updatedAt: now },
    { organizationId: ORGS.bones.id, createdAt: now, updatedAt: now },
  ]);

  // Branding settings (with logo URLs pointing to seeded R2 files)
  await db.insert(schema.brandingSettings).values([
    {
      organizationId: ORGS.alpha.id,
      primaryColorHex: ORGS.alpha.primaryColor,
      // The seeded org with a shader and its own heading colour: the browser
      // suite reads both (`e2e/page-kit/org-shader.spec.ts`,
      // `e2e/org/explore-heading.spec.ts`). This is the whole brand those
      // suites were made green against, copied from the local row it was
      // tuned in (2026-09-27), so a fresh seed tests the look that was tested.
      secondaryColorHex: '#737373',
      accentColorHex: '#F59E0B',
      fontHeading: 'Inter',
      fontBody: 'Inter',
      radiusValue: '0.375',
      densityValue: '0.96',
      heroLayout: 'centered',
      tokenOverrides: JSON.stringify({
        'shader-preset': 'glow',
        'shader-intensity': '0.9',
        'shader-vignette': '0.45',
        'shader-glow-drift': '0.16',
        'shader-glow-count': '8',
        'shader-glow-size': '0.8',
        'text-scale': '1',
        'heading-weight': '600',
        'body-weight': '400',
        'text-transform-label': 'uppercase',
        'shadow-scale': '0.9',
        'shadow-color': '220 6% 14%',
        'card-hover-scale': '1.015',
        'card-image-hover-scale': '1.03',
        'heading-color': '#E11D48',
        'glass-tint': '#FDE7CF',
        'hero-text': '#FFFFFF',
        'hero-text-muted': '#FFFFFF',
        'hero-title-color': '#FFFFFF',
        'hero-title-blend': 'normal',
        'hero-glass-text': '#FFFFFF',
        'hero-glass-tint': '#FFFFFF',
        'hero-border-tint': '#FFFFFF',
        'hero-logo-scale': '1.05',
        'hero-cta-bg': '#F59E0B',
        'hero-cta-text': '#000000',
      }),
      darkModeOverrides: JSON.stringify({ primaryColor: '#E11D48' }),
      darkTokenOverrides: JSON.stringify({
        'heading-color': '#FF4C64',
        'glass-tint': '#261704',
        'shadow-color': '220 10% 5%',
      }),
      logoUrl: `http://localhost:4100/${getOrgLogoKey(ORGS.alpha.id, 'md')}`,
      pricingFaq: JSON.stringify([
        {
          id: 'seed-faq-cancel',
          question: 'Can I cancel my subscription at any time?',
          answer:
            'Absolutely! You can cancel your subscription from your account settings at any point. Your access continues until the end of your current billing period — no surprise charges.',
          order: 0,
        },
        {
          id: 'seed-faq-difference',
          question: 'What is the difference between Standard and Pro?',
          answer:
            'Standard gives you access to all tutorials and workshops. Pro unlocks everything including deep-dives, masterclasses, and early access to new content.',
          order: 1,
        },
        {
          id: 'seed-faq-team',
          question: 'Do you offer team or group pricing?',
          answer:
            'Not yet, but we are working on team plans for 2026. In the meantime, each team member can subscribe individually.',
          order: 2,
        },
      ]),
      createdAt: now,
      updatedAt: now,
    },
    {
      organizationId: ORGS.beta.id,
      primaryColorHex: ORGS.beta.primaryColor,
      logoUrl: `http://localhost:4100/${getOrgLogoKey(ORGS.beta.id, 'md')}`,
      createdAt: now,
      updatedAt: now,
    },
    {
      organizationId: ORGS.bones.id,
      primaryColorHex: ORGS.bones.primaryColor,
      backgroundColorHex: '#F3F0E7',
      fontHeading: 'Cardo',
      fontBody: null,
      radiusValue: '0.33',
      densityValue: '1',
      logoUrl: `http://localhost:4100/${getOrgLogoKey(ORGS.bones.id, 'md')}`,
      // Fine-tune fields (heading colour, weights, shadow scale, etc.) live as
      // keys inside tokenOverrides JSON since Codex-g49b4 dropped the
      // broken-out columns.
      tokenOverrides: JSON.stringify({
        'heading-color': '#A62B0C',
        'heading-weight': '400',
        'body-weight': '400',
        'shadow-scale': '0.5',
      }),
      createdAt: now,
      updatedAt: now,
    },
  ]);

  // Contact settings
  await db.insert(schema.contactSettings).values([
    {
      organizationId: ORGS.alpha.id,
      platformName: SETTINGS.alpha.platformName,
      supportEmail: SETTINGS.alpha.supportEmail,
      contactUrl: SETTINGS.alpha.contactUrl,
      timezone: 'America/New_York',
      createdAt: now,
      updatedAt: now,
    },
    {
      organizationId: ORGS.beta.id,
      platformName: SETTINGS.beta.platformName,
      supportEmail: SETTINGS.beta.supportEmail,
      contactUrl: SETTINGS.beta.contactUrl,
      timezone: 'America/Los_Angeles',
      createdAt: now,
      updatedAt: now,
    },
    {
      organizationId: ORGS.bones.id,
      platformName: SETTINGS.bones.platformName,
      supportEmail: SETTINGS.bones.supportEmail,
      contactUrl: SETTINGS.bones.contactUrl,
      timezone: 'Europe/London',
      instagramUrl: 'https://instagram.com/of.blood.and.bones',
      createdAt: now,
      updatedAt: now,
    },
  ]);

  // Feature settings
  await db.insert(schema.featureSettings).values([
    {
      organizationId: ORGS.alpha.id,
      enableSignups: true,
      enablePurchases: true,
      enableSubscriptions: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      organizationId: ORGS.beta.id,
      enableSignups: true,
      enablePurchases: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      organizationId: ORGS.bones.id,
      enableSignups: true,
      enablePurchases: true,
      enableSubscriptions: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  console.log(
    `  Seeded ${Object.keys(ORGS).length} orgs with memberships and settings`
  );
}
