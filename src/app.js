const express = require("express");
const { pingRedis } = require("./config/redis");
const authRoutes = require("./routes/auth");
const eventRoutes = require("./routes/events");
const bookingRoutes = require("./routes/bookings");

const app = express();

app.use(express.json());

// for the demo health check wheather all were connect expectedly or not(mongoDB, Redis for bullque background jobs).
app.get("/health", async (_req, res) => {
  try {
    const mongoose = require("mongoose");
    const mongoOk = mongoose.connection.readyState === 1;
    const redisOk = await pingRedis();

    if (!mongoOk || !redisOk) {
      return res.status(503).json({
        status: "degraded",
        mongo: mongoOk,
        redis: redisOk,
      });
    }

    return res.json({
      status: "ok",
      mongo: true,
      redis: true,
    });
  } catch (err) {
    return res.status(503).json({
      status: "error",
      message: err.message,
    });
  }
});

//following are the basic routes for this Application.

//for the registartion and the login.
app.use("/api/auth", authRoutes);
//for creating, patching and viewing related all the Endpoints will be here.
app.use("/api/events", eventRoutes);
//this will show the booking that are for the respective customer.
app.use("/api/bookings", bookingRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({
    message: err.message || "Internal server error",
  });
});

module.exports = app;
