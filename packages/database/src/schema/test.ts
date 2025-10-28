import { integer, pgTable } from 'drizzle-orm/pg-core';

export const usersTable = pgTable('test_table', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
});
