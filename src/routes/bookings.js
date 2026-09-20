const express = require("express");
const Booking = require("../models/Booking");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/role");

const router = express.Router();

// Customer — list my bookings used the middleware to protected on the role base.
router.get("/", authenticate, authorize("customer"), async (req, res) => {
  try {
    const bookings = await Booking.find({ customerId: req.user.id })
      .populate("eventId", "title description location date availableTickets")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ bookings });
  } catch (err) {
    console.error("List bookings error:", err);
    return res.status(500).json({ message: "Failed to list bookings" });
  }
});

module.exports = router;
