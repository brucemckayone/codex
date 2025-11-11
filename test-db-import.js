import { dbWs } from './packages/database/src/client.ts';

console.log('dbWs:', dbWs);
console.log('dbWs keys:', Object.keys(dbWs));
console.log('dbWs.insert:', dbWs.insert);
console.log('dbWs.insert type:', typeof dbWs.insert);
