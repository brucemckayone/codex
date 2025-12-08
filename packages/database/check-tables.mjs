import 'dotenv/config';
import { dbHttp } from './dist/index.js';

const result = await dbHttp.execute(`
  SELECT tablename
  FROM pg_tables
  WHERE schemaname = 'public'
  AND tablename LIKE '%verif%'
`);

console.log('Tables with "verif" in name:');
console.log(JSON.stringify(result.rows, null, 2));

const allTables = await dbHttp.execute(`
  SELECT tablename
  FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY tablename
`);

console.log('\nAll tables:');
console.log(JSON.stringify(allTables.rows, null, 2));
