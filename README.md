# Event Booking System

Node.js / Express API for event organizers and customers, with JWT RBAC, atomic ticket reservation, BullMQ background emails (Resend), and measured concurrent booking stress tests.

## Stack

- **Node.js + Express** — HTTP API
- **MongoDB Atlas** — users, events, bookings
- **Redis (Upstash)** — BullMQ job broker
- **BullMQ** — async email workers
- **Resend** — real transactional email
- **JWT + bcrypt** — auth

## Architecture

```
Client
  → Express API (RBAC)
      → MongoDB (atomic ticket decrement + booking write)
      → BullMQ queue (Redis)
            → Worker process
                  → Resend (real email)
```

Two long-running processes are required:

1. **API** — `npm start`
2. **Worker** — `npm run worker`

## Roles

| Role | Can |
|------|-----|
| **Organizer** | Register/login, create events, update own events |
| **Customer** | Register/login, browse events, book tickets, list own bookings |

Organizers cannot book. Customers cannot create/update events.

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | — | Register (`role`: `organizer` \| `customer`) |
| POST | `/api/auth/login` | — | Login → JWT |
| GET | `/api/auth/me` | JWT | Current user |
| GET | `/api/events` | — | List events |
| GET | `/api/events/:id` | — | Get event |
| POST | `/api/events` | Organizer | Create event |
| PATCH | `/api/events/:id` | Organizer (owner) | Update event details |
| POST | `/api/events/:id/bookings` | Customer | Book tickets |
| GET | `/api/bookings` | Customer | My bookings |
| GET | `/health` | — | Mongo + Redis health |

## Booking concurrency (design decision)

Ticket reservation uses a single atomic MongoDB update so concurrent requests cannot oversell:

```js
Event.findOneAndUpdate(
  { _id: eventId, availableTickets: { $gte: quantity } },
  { $inc: { availableTickets: -quantity } },
  { returnDocument: "after" }
);
```

- If the update returns a document → enough tickets existed; create the booking.
- If it returns `null` → either the event is missing or inventory was exhausted → `404` / `409`.

This is preferred over read-check-write (race-prone) and over multi-document transactions (heavier than needed for this assignment).

## Background jobs

### Booking confirmation

`POST /bookings` → save booking → enqueue `booking-confirmation` → worker → Resend email

### Event update notification

`PATCH /events/:id` → save event → find distinct customers with confirmed bookings → enqueue `event-update` per customer → worker → Resend emails

Console logging alone is not used for delivery. Set `DISABLE_EMAIL_QUEUE=true` only for load tests so Resend is not flooded.

## Performance

Measured locally against MongoDB Atlas + Upstash Redis with email queue disabled (`DISABLE_EMAIL_QUEUE=true`).

Machine: Windows Node 20, API on `localhost:3000`.  
Script: `npm run load-test` (`scripts/load-test.js`).  
Each stress level creates a **fresh event with 100 tickets**, then fires N concurrent `quantity=1` bookings.

### Correctness probe

| Tickets | Concurrent | Success (201) | Conflict (409) | Final available | Oversold? |
|--------:|-----------:|--------------:|---------------:|----------------:|:---------:|
| 10 | 20 | **10** | **10** | **0** | **No** |

Atomic reservation held under contention.

### Stress results (100 tickets per event)

| Concurrent users | Success | Conflict (409) | Other errors | Final available | p50 (ms) | p95 (ms) | Wall (ms) |
|-----------------:|--------:|---------------:|-------------:|----------------:|---------:|---------:|----------:|
| 50 | 50 | 0 | 0 | 50 | 568 | 638 | 722 |
| 100 | 100 | 0 | 0 | 0 | 1724 | 1822 | 1943 |
| 250 | 100 | 150 | 0 | 0 | 3755 | 4700 | 4779 |
| 500 | 100 | 186 | 214 | 0 | 3299 | 6254 | 6624 |

### Interpretation

- **Up to ~100 concurrent bookers** for a 100-ticket event: all requests complete cleanly; inventory stays exact.
- **~250 concurrent**: inventory still exact (100 sold, 150 rejected with 409). Latency rises (p95 ≈ 4.7s) because Atlas round-trips dominate under fan-out.
- **~500 concurrent**: inventory still never goes negative (100 successes, `available=0`), but **~214 requests fail** (connection resets / refused under local Node + remote DB pressure). This is where the single-process API + free-tier remote DB **degrades**.

**How many simultaneous bookers can it handle?**  
For correct inventory: **at least 250 concurrent** with clean HTTP outcomes; at **500** correctness still holds but the server starts dropping connections. Practical sweet spot for this free-tier stack: **~100–250 concurrent booking requests**.

### Optimization applied

Atomic `findOneAndUpdate` (above) is the booking path — no separate non-atomic baseline was kept in production code because overselling would fail the assignment. Load numbers above are for that optimized path.

## Local setup

1. Copy `.env.example` → `.env` and fill values.
2. `npm install`
3. Terminal A: `npm start`
4. Terminal B: `npm run worker`
5. Optional: `npm run load-test`

### Environment variables

| Variable | Purpose |
|----------|---------|
| `PORT` | API port (default 3000) |
| `MONGODB_URI` | MongoDB Atlas connection string |
| `REDIS_URL` | Upstash Redis URL (`rediss://…`) |
| `JWT_SECRET` | JWT signing secret |
| `RESEND_API_KEY` | Resend API key |
| `EMAIL_FROM` | From address (`beth.t@example.com` for testing) |
| `DISABLE_EMAIL_QUEUE` | `true` to skip enqueue during load tests |

**Resend free tier:** until a domain is verified, emails only deliver to your Resend signup address (or Resend test sinks). Register demo customers with that address.

## Deployment

Deployed on **Railway** (web `api` + background `worker`).

> **Deployed URL:** https://api-production-27adf.up.railway.app  
> Health: https://api-production-27adf.up.railway.app/health  
> Dashboard: https://railway.com/project/35f77438-0efd-44c2-b853-afc3141edd26

`SERVICE_ROLE=api|worker` selects the process via `src/boot.js`. Env vars are set in Railway (MongoDB, Redis, JWT, Resend).

A `render.yaml` Blueprint is also included if you prefer Render later.

## Design trade-offs / future improvements

- **Skipped:** delete event, pagination, idempotency keys, fancy validation, frontend, extensive unit tests.
- **Ticket counts** are not editable after create (avoids inventory races).
- **Email failures** do not roll back bookings (queue retries 3×); acceptable for this scope.
- **Improvements:** connection pooling / horizontal API replicas, Redis-backed rate limits, booking idempotency, verified custom domain for Resend, CDN-free health warmers on free hosts.

## Project structure

```
src/
├── models/          User, Event, Booking
├── routes/          auth, events, bookings
├── middleware/      authenticate, authorize
├── queues/          emailQueue, emailWorker
├── services/        email (Resend)
├── config/          db, redis
├── app.js
└── server.js
scripts/
└── load-test.js
```
