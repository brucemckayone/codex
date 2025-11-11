import { dbWs, dbHttp } from './packages/database/src/index.ts';

console.log('dbWs:', dbWs);
console.log('dbWs keys:', Object.keys(dbWs));
console.log('dbWs.insert:', dbWs.insert);
console.log('dbHttp:', dbHttp);
console.log('dbHttp keys:', Object.keys(dbHttp));
