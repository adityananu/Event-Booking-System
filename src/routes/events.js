const express = require("express");
const mongoose = require("mongoose");
const Event = require("../models/Event");
const Booking = require("../models/Booking");
const User = require("../models/User");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/role");
const {
  enqueueBookingConfirmation,
  enqueueEventUpdateNotification,
} = require("../queues/emailQueue");

const router = express.Router();

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// Public — browse all events available listed.
router.get("/", async (_req, res) => {
  try {
    const events = await Event.find()
      .sort({ date: 1 })
      .select("-__v")
      .lean();

    return res.json({ events });
  } catch (err) {
    console.error("List events error:", err);
    return res.status(500).json({ message: "Failed to list events" });
  }
});

// Public — get one event on the event._id base which is primary key.
router.get("/:id", async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid event id" });
    }

    const event = await Event.findById(req.params.id).select("-__v").lean();
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    return res.json({ event });
  } catch (err) {
    console.error("Get event error:", err);
    return res.status(500).json({ message: "Failed to get event" });
  }
});

// Organizer — create event (only organizer) protected by middleware using JWT
router.post("/", authenticate, authorize("organizer"), async (req, res) => {
  try {
    const { title, description, location, date, totalTickets } = req.body;

    if (!title || !description || !location || !date || totalTickets == null) {
      return res.status(400).json({
        message:
          "title, description, location, date, and totalTickets are required",
      });
    }

    const tickets = Number(totalTickets);
    if (!Number.isInteger(tickets) || tickets < 1) {
      return res.status(400).json({
        message: "totalTickets must be a positive integer",
      });
    }

    const eventDate = new Date(date);
    if (Number.isNaN(eventDate.getTime())) {
      return res.status(400).json({ message: "Invalid date" });
    }

    const event = await Event.create({
      title: title.trim(),
      description: description.trim(),
      location: location.trim(),
      date: eventDate,
      totalTickets: tickets,
      availableTickets: tickets,
      organizerId: req.user.id,
    });

    return res.status(201).json({ event });
  } catch (err) {
    console.error("Create event error:", err);
    return res.status(500).json({ message: "Failed to create event" });
  }
});

// Organizer — update existing event (only organizer) protected by middleware using JWT
router.patch("/:id", authenticate, authorize("organizer"), async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid event id" });
    }

    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (event.organizerId.toString() !== req.user.id) {
      return res.status(403).json({
        message: "You can only update events you created",
      });
    }

    const { title, description, location, date } = req.body;

    if (title !== undefined) event.title = title.trim();
    if (description !== undefined) event.description = description.trim();
    if (location !== undefined) event.location = location.trim();
    if (date !== undefined) {
      const eventDate = new Date(date);
      if (Number.isNaN(eventDate.getTime())) {
        return res.status(400).json({ message: "Invalid date" });
      }
      event.date = eventDate;
    }

    await event.save();

    // Notify all customers who booked this event (background) using bullmq
    if (process.env.DISABLE_EMAIL_QUEUE !== "true") {
      try {
        const bookings = await Booking.find({
          eventId: event._id,
          status: "confirmed",
        })
          .select("customerId")
          .lean();

        const customerIds = [
          ...new Set(bookings.map((b) => b.customerId.toString())),
        ];

        if (customerIds.length > 0) {
          const customers = await User.find({ _id: { $in: customerIds } })
            .select("name email")
            .lean();

          await Promise.all(
            customers.map((customer) =>
              enqueueEventUpdateNotification({
                to: customer.email,
                customerName: customer.name,
                eventTitle: event.title,
                location: event.location,
                eventDate: event.date,
              })
            )
          );
        }
      } catch (queueErr) {
        console.error("Failed to enqueue event-update emails:", queueErr);
      }
    }

    return res.json({ event });
  } catch (err) {
    console.error("Update event error:", err);
    return res.status(500).json({ message: "Failed to update event" });
  }
});

// Customer — book tickets (atomic reservation) and email sending using the resend app.
router.post(
  "/:id/bookings",
  authenticate,
  authorize("customer"),
  async (req, res) => {
    try {
      if (!isValidObjectId(req.params.id)) {
        return res.status(400).json({ message: "Invalid event id" });
      }

      const quantity = Number(req.body.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({
          message: "quantity must be a positive integer",
        });
      }

      // Atomic: only succeed if enough tickets remain
      const event = await Event.findOneAndUpdate(
        {
          _id: req.params.id,
          availableTickets: { $gte: quantity },
        },
        {
          $inc: { availableTickets: -quantity },
        },
        { returnDocument: "after" }
      );

      if (!event) {
        const exists = await Event.exists({ _id: req.params.id });
        if (!exists) {
          return res.status(404).json({ message: "Event not found" });
        }
        return res.status(409).json({
          message: "Not enough tickets available",
        });
      }

      const booking = await Booking.create({
        eventId: event._id,
        customerId: req.user.id,
        quantity,
        status: "confirmed",
      });

      if (process.env.DISABLE_EMAIL_QUEUE !== "true") {
        try {
          await enqueueBookingConfirmation({
            to: req.user.email,
            customerName: req.user.name,
            eventTitle: event.title,
            quantity,
            bookingId: booking._id.toString(),
            eventDate: event.date,
            location: event.location,
          });
        } catch (queueErr) {
          console.error("Failed to enqueue booking confirmation:", queueErr);
        }
      }

      return res.status(201).json({
        booking,
        event: {
          id: event._id,
          title: event.title,
          availableTickets: event.availableTickets,
        },
      });
    } catch (err) {
      console.error("Book tickets error:", err);
      return res.status(500).json({ message: "Failed to book tickets" });
    }
  }
);

module.exports = router;
