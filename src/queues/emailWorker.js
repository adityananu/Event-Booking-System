if (!globalThis.crypto) {
  globalThis.crypto = require("crypto").webcrypto;
}

require("dotenv").config();

const { Worker } = require("bullmq");
const { createRedisConnection } = require("../config/redis");
const { QUEUE_NAME } = require("./emailQueue");
const {
  sendBookingConfirmation,
  sendEventUpdateNotification,
} = require("../services/email");

const connection = createRedisConnection();

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    console.log(`[email-worker] processing ${job.name} id=${job.id}`);

    if (job.name === "booking-confirmation") {
      const result = await sendBookingConfirmation(job.data);
      console.log(
        `[email-worker] booking confirmation sent to ${job.data.to} resendId=${result?.id}`
      );
      return result;
    }

    if (job.name === "event-update") {
      const result = await sendEventUpdateNotification(job.data);
      console.log(
        `[email-worker] event update sent to ${job.data.to} resendId=${result?.id}`
      );
      return result;
    }

    throw new Error(`Unknown job name: ${job.name}`);
  },
  { connection }
);

worker.on("completed", (job) => {
  console.log(`[email-worker] completed ${job.name} id=${job.id}`);
});

worker.on("failed", (job, err) => {
  console.error(
    `[email-worker] failed ${job?.name} id=${job?.id}:`,
    err.message
  );
});

console.log("[email-worker] listening for jobs...");

async function shutdown() {
  console.log("[email-worker] shutting down...");
  await worker.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
