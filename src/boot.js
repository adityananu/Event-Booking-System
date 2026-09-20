if (!globalThis.crypto) {
  globalThis.crypto = require("crypto").webcrypto;
}

require("dotenv").config();

if (process.env.SERVICE_ROLE === "worker") {
  require("./queues/emailWorker");
} else {
  require("./server");
}
