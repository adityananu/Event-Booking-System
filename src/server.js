if (!globalThis.crypto) {
  globalThis.crypto = require("crypto").webcrypto;
}

require("dotenv").config();

const app = require("./app");
const { connectDB } = require("./config/db");
const { getRedis } = require("./config/redis");

const PORT = process.env.PORT || 3000;

async function start() {
  await connectDB();
  getRedis();

  app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
