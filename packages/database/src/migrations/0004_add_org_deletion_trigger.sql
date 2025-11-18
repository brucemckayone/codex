-- Trigger to unpublish content when organization is deleted
-- This prevents content from auto-publishing to creator's personal page
-- when organization_id is SET NULL by CASCADE

CREATE OR REPLACE FUNCTION unpublish_content_on_org_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- When organization_id becomes NULL (org deleted), set status to draft
  -- This prevents published org content from appearing on creator's personal page
  IF OLD.organization_id IS NOT NULL AND NEW.organization_id IS NULL THEN
    NEW.status := 'draft';
    NEW.published_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER trigger_unpublish_on_org_delete
  BEFORE UPDATE ON content
  FOR EACH ROW
  WHEN (OLD.organization_id IS DISTINCT FROM NEW.organization_id)
  EXECUTE FUNCTION unpublish_content_on_org_delete();
