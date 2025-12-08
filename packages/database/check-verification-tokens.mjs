import 'dotenv/config';
import { dbHttp } from './dist/index.js';

// Check for any verification tokens
const result = await dbHttp.execute(`
  SELECT * FROM verification ORDER BY "created_at" DESC LIMIT 5
`);

console.log('Recent verification tokens:');
console.log(JSON.stringify(result.rows, null, 2));
