// Placeholder for PurchasesService types
// See /design/features/e-commerce/ttd-dphase-1.md

export interface IPurchasesService {
  createCheckoutSession(userId: string, itemId: string, itemType: string): Promise<{ checkoutUrl:string }>;
  // ... other methods
}
