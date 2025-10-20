import { QueueMessage } from "packages/shared/types";
import { transcode } from "./jobs/transcode";
import { Env } from "./types";

export default {
  async fetch(req: Request, env: Env) {
    if (req.method === "POST") {
      const message: QueueMessage = await req.json();

      // You can optionally store some metadata in KV
      await env.SESSIONS.put(`job:${message.jobId}`, JSON.stringify(message));

      // Handle different job types
      switch (message.jobType) {
        case "transcode":
          await transcode(message.jobId, message.r2Key, env);
          break;
      }

      return new Response("OK");
    }

    return new Response("Worker running");
  },
};
