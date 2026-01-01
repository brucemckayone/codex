-- Truncate media_items table and all dependent data
-- CASCADE will also clear content.media_item_id references (set to NULL due to ON DELETE SET NULL)
TRUNCATE TABLE media_items CASCADE;
