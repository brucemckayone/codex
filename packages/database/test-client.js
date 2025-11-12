/* globals process */
import { drizzle } from 'drizzle-orm/neon-serverless';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

// Configure WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

console.log('db keys:', Object.keys(db));
console.log('db.insert:', typeof db.insert);
console.log('db.delete:', typeof db.delete);
console.log('db.select:', typeof db.select);
console.log('db.transaction:', typeof db.transaction);
