import { integer, pgTable } from 'drizzle-orm/pg-core';

export const testTable = pgTable('test_table', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
});
