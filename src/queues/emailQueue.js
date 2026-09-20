const { Queue } = require("bullmq");
const { createRedisConnection } = require("../config/redis");

const QUEUE_NAME = "email";

let emailQueue;

function getEmailQueue() {
  if (emailQueue) return emailQueue;

  emailQueue = new Queue(QUEUE_NAME, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });

  return emailQueue;
}

async function enqueueBookingConfirmation(payload) {
  const queue = getEmailQueue();
  return queue.add("booking-confirmation", payload, {
    jobId: `booking-${payload.bookingId}`,
  });
}

async function enqueueEventUpdateNotification(payload) {
  const queue = getEmailQueue();
  return queue.add("event-update", payload);
}

module.exports = {
  QUEUE_NAME,
  getEmailQueue,
  enqueueBookingConfirmation,
  enqueueEventUpdateNotification,
};
