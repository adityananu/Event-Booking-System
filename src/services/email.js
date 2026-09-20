const { Resend } = require("resend");

let resend;

function getResend() {
  if (resend) return resend;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set");
  }

  resend = new Resend(apiKey);
  return resend;
}

function getFrom() {
  return process.env.EMAIL_FROM || "beth.t@example.com";
}

async function sendBookingConfirmation({
  to,
  customerName,
  eventTitle,
  quantity,
  bookingId,
  eventDate,
  location,
}) {
  const when = eventDate ? new Date(eventDate).toUTCString() : "TBA";
  const { data, error } = await getResend().emails.send({
    from: getFrom(),
    to: [to],
    subject: `Booking confirmed: ${eventTitle}`,
    html: `
      <h2>Booking confirmed</h2>
      <p>Hi ${customerName},</p>
      <p>Your booking for <strong>${eventTitle}</strong> is confirmed.</p>
      <ul>
        <li><strong>Tickets:</strong> ${quantity}</li>
        <li><strong>Location:</strong> ${location || "TBA"}</li>
        <li><strong>Date:</strong> ${when}</li>
        <li><strong>Booking ID:</strong> ${bookingId}</li>
      </ul>
      <p>See you there!</p>
    `,
  });

  if (error) {
    throw new Error(error.message || "Resend booking email failed");
  }

  return data;
}

async function sendEventUpdateNotification({
  to,
  customerName,
  eventTitle,
  location,
  eventDate,
}) {
  const when = eventDate ? new Date(eventDate).toUTCString() : "TBA";
  const { data, error } = await getResend().emails.send({
    from: getFrom(),
    to: [to],
    subject: `Event updated: ${eventTitle}`,
    html: `
      <h2>Event details changed</h2>
      <p>Hi ${customerName},</p>
      <p>An event you booked has been updated by the organizer.</p>
      <ul>
        <li><strong>Event:</strong> ${eventTitle}</li>
        <li><strong>Location:</strong> ${location || "TBA"}</li>
        <li><strong>Date:</strong> ${when}</li>
      </ul>
      <p>Please review the new details.</p>
    `,
  });

  if (error) {
    throw new Error(error.message || "Resend event-update email failed");
  }

  return data;
}

module.exports = {
  sendBookingConfirmation,
  sendEventUpdateNotification,
};
