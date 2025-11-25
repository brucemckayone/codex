-- Seed default platform fee configuration
-- Phase 1: 10% platform fee (1000 basis points)
-- effectiveUntil = NULL means indefinite (current active config)

INSERT INTO "platform_fee_config" (
  "platform_fee_percentage",
  "effective_from",
  "effective_until"
) VALUES (
  1000,  -- 10% (1000 basis points = 10.00%)
  NOW(),
  NULL   -- Indefinite
)
ON CONFLICT DO NOTHING;
