import { sql } from 'drizzle-orm';
import { dbWs } from '../src/index.js';

async function checkViolatingMedia() {
  const violating = await dbWs.execute(sql`
    SELECT id, title, status, hls_master_playlist_key, thumbnail_key, duration_seconds
    FROM media_items
    WHERE status = 'ready'
      AND (hls_master_playlist_key IS NULL OR thumbnail_key IS NULL OR duration_seconds IS NULL)
  `);

  console.log(`Found ${violating.rows.length} violating rows:\n`);
  console.log(JSON.stringify(violating.rows, null, 2));

  await dbWs.end();
}

checkViolatingMedia().catch(console.error);
