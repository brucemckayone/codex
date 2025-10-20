import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env file based on MF_ENV or default to dev
const envFile = process.env.MF_ENV || "dev";
dotenv.config({ path: join(__dirname, `../../.env.${envFile}`) });

export default {
  scriptPath: join(__dirname, "src/index.ts"),
  modules: true,
  watch: true,
  kvNamespaces: [{ binding: "SESSIONS", id: process.env.SESSIONS_KV_ID }],
  r2Buckets: [{ binding: "BUCKET_NAME", bucketName: process.env.BUCKET_NAME }],
  queues: [
    { binding: "TASK_QUEUE", queueName: process.env.TASK_QUEUE_NAME },
    {
      binding: "NOTIFICATIONS",
      queueName: process.env.NOTIFICATIONS_QUEUE_NAME,
    },
  ],
  envPath: join(__dirname, `../../.env.${envFile}`),
  compatibilityDate: "2025-10-19",
};
