import type { Handler } from "@netlify/functions";
import { runOutboxWorker } from "../../src/outbox/worker.js";

export const config = { schedule: "* * * * *" };

export const handler: Handler = async () => {
  const result = await runOutboxWorker();
  return {
    statusCode: result.failed ? 207 : 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result)
  };
};
