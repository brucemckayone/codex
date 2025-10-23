// Placeholder for ContentAccessService types
// See /design/features/content-access/ttd-dphase-1.md

export interface IContentAccessService {
  checkAccess(userId: string, itemId: string, itemType: string): Promise<boolean>;
  grantAccess(userId: string, itemId: string, itemType: string): Promise<void>;
  // ... other methods
}
