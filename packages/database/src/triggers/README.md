# Database Triggers

This directory tracks custom PostgreSQL triggers and functions that are **not managed by Drizzle ORM**.

## Why Triggers?

Triggers enforce business logic at the database level when application-level constraints aren't sufficient or when we need guarantees that survive direct SQL access.

## Current Triggers

### 1. `trigger_unpublish_on_org_delete`

**Purpose**: Prevent auto-publishing content to creator's personal page when organization is deleted

**Trigger**:
- **Table**: `content`
- **Event**: `BEFORE UPDATE`
- **Condition**: When `organization_id` changes from NOT NULL to NULL

**Function**: `unpublish_content_on_org_delete()`

**Business Logic**:
When an organization is deleted, the foreign key cascade sets `organization_id = NULL` on all content. Without this trigger, published organization content would suddenly appear as published on the creator's personal page.

**Behavior**:
- Sets `status = 'draft'`
- Sets `published_at = NULL`
- Creator must review and manually re-publish to their personal page

**Migration**: Applied in `0004_add_org_deletion_trigger.sql`

---

## Adding New Triggers

1. **Create SQL file** in `packages/database/src/migrations/XXXX_your_trigger.sql`
2. **Update registry** in `packages/database/src/triggers/index.ts`
3. **Document here** in this README
4. **Add test** to verify trigger exists and works

### SQL Template

```sql
-- Function
CREATE OR REPLACE FUNCTION your_function_name()
RETURNS TRIGGER AS $$
BEGIN
  -- Your logic here
  RETURN NEW; -- or OLD for DELETE triggers
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Trigger
CREATE TRIGGER your_trigger_name
  BEFORE/AFTER INSERT/UPDATE/DELETE ON table_name
  FOR EACH ROW
  WHEN (your_condition)
  EXECUTE FUNCTION your_function_name();
```

### Registry Template

```typescript
export const DATABASE_TRIGGERS = {
  your_trigger_key: {
    table: 'table_name',
    triggerName: 'your_trigger_name',
    functionName: 'your_function_name',
    event: 'BEFORE UPDATE',
    when: 'condition description',
    description: 'What the trigger does',
    migration: 'XXXX_your_trigger.sql',
    businessReason: 'Why we need this trigger',
    appliedInMigration: 'XXXX_your_trigger',
  },
};
```

---

## Testing Triggers

```typescript
import { DATABASE_TRIGGERS, getAllTriggerNames } from '@codex/database/triggers';

// Example test
it('should have trigger for unpublishing content on org delete', async () => {
  const result = await db.execute(sql`
    SELECT tgname FROM pg_trigger
    WHERE tgname = 'trigger_unpublish_on_org_delete'
  `);

  expect(result.rows).toHaveLength(1);
});
```

---

## Removing Triggers

If a trigger needs to be removed:

1. Create a new migration:
   ```sql
   DROP TRIGGER IF EXISTS trigger_name ON table_name;
   DROP FUNCTION IF EXISTS function_name();
   ```

2. Update the registry (mark as deprecated or remove)
3. Document the removal reason

---

## Best Practices

- ✅ **Use triggers sparingly** - prefer application logic when possible
- ✅ **Document business reason** - why can't this be app-level?
- ✅ **Keep triggers simple** - complex logic should be in application
- ✅ **Test thoroughly** - triggers can have unexpected side effects
- ✅ **Version carefully** - trigger changes can affect running transactions
- ❌ **Don't hide business logic** - triggers should be well-documented
- ❌ **Don't create circular dependencies** - trigger calling trigger calling trigger
