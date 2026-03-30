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
      id: MEMBERSHIPS.viewerAlphaMember.id,
      organizationId: ORGS.alpha.id,
      userId: USERS.viewer.id,
      role: 'member',
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
  ]);

  // Platform settings hub (required FK target for spoke tables)
  await db.insert(schema.platformSettings).values([
    { organizationId: ORGS.alpha.id, createdAt: now, updatedAt: now },
    { organizationId: ORGS.beta.id, createdAt: now, updatedAt: now },
  ]);

  // Branding settings
  await db.insert(schema.brandingSettings).values([
    {
      organizationId: ORGS.alpha.id,
      primaryColorHex: ORGS.alpha.primaryColor,
      createdAt: now,
      updatedAt: now,
    },
    {
      organizationId: ORGS.beta.id,
      primaryColorHex: ORGS.beta.primaryColor,
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
  ]);

  // Feature settings
  await db.insert(schema.featureSettings).values([
    {
      organizationId: ORGS.alpha.id,
      enableSignups: true,
      enablePurchases: true,
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
  ]);

  console.log(
    `  Seeded ${Object.keys(ORGS).length} orgs with memberships and settings`
  );
}
