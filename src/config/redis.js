const IORedis = require("ioredis");

let sharedClient;

function createRedisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is not set");
  }

  const client = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  client.on("error", (err) => {
    console.error("Redis error:", err.message);
  });

  return client;
}

function getRedis() {
  if (!sharedClient) {
    sharedClient = createRedisConnection();
  }
  return sharedClient;
}

async function pingRedis() {
  const client = getRedis();
  const result = await client.ping();
  return result === "PONG";
}

module.exports = { getRedis, createRedisConnection, pingRedis };
