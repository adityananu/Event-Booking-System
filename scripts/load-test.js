/**
 * Concurrent booking stress test.
 *
 * Usage:
 *   node scripts/load-test.js
 *   node scripts/load-test.js --base http://localhost:3000 --levels 50,100,250,500 --tickets 100
 *
 * For each concurrency level N:
 *   - Creates a fresh event with `tickets` available
 *   - Fires N simultaneous booking requests (quantity=1) with the same customer JWT
 *   - Reports success / conflict / error counts, latency percentiles, and final inventory
 */

const BASE = process.env.BASE_URL || argValue("--base") || "http://localhost:3000";
const TICKETS = Number(argValue("--tickets") || 100);
const LEVELS = (argValue("--levels") || "50,100,250,500")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => n > 0);

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1
  );
  return sorted[Math.max(0, idx)];
}

async function json(method, path, { token, body } = {}) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    return { status: res.status, data };
  } catch (err) {
    return { status: 0, data: { message: err.message } };
  }
}

async function setupActors() {
  const ts = Date.now();

  const org = await json("POST", "/api/auth/register", {
    body: {
      name: "Load Org",
      email: `load.org.${ts}@test.com`,
      password: "secret12",
      role: "organizer",
    },
  });
  if (org.status !== 201) {
    throw new Error(`Organizer register failed: ${JSON.stringify(org)}`);
  }

  const cust = await json("POST", "/api/auth/register", {
    body: {
      name: "Load Customer",
      email: `load.cust.${ts}@test.com`,
      password: "secret12",
      role: "customer",
    },
  });
  if (cust.status !== 201) {
    throw new Error(`Customer register failed: ${JSON.stringify(cust)}`);
  }

  return {
    orgToken: org.data.token,
    custToken: cust.data.token,
  };
}

async function createEvent(orgToken, tickets, label) {
  const ev = await json("POST", "/api/events", {
    token: orgToken,
    body: {
      title: `Load Test ${label}`,
      description: "Concurrent booking stress scenario",
      location: "Load Lab",
      date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      totalTickets: tickets,
    },
  });
  if (ev.status !== 201) {
    throw new Error(`Create event failed: ${JSON.stringify(ev)}`);
  }
  return ev.data.event._id;
}

async function runLevel({ orgToken, custToken, concurrency, tickets }) {
  const eventId = await createEvent(orgToken, tickets, `c${concurrency}`);

  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: concurrency }, async () => {
      const t0 = Date.now();
      const res = await json("POST", `/api/events/${eventId}/bookings`, {
        token: custToken,
        body: { quantity: 1 },
      });
      return {
        status: res.status,
        ms: Date.now() - t0,
      };
    })
  );
  const wallMs = Date.now() - started;

  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const success = results.filter((r) => r.status === 201).length;
  const conflict = results.filter((r) => r.status === 409).length;
  const other = results.filter(
    (r) => r.status !== 201 && r.status !== 409
  ).length;

  const final = await json("GET", `/api/events/${eventId}`);
  const available = final.data.event?.availableTickets;

  return {
    concurrency,
    tickets,
    success,
    conflict,
    other,
    available,
    wallMs,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    maxMs: latencies[latencies.length - 1] || 0,
    inventoryOk: available === Math.max(0, tickets - success),
    oversold: typeof available === "number" && available < 0,
  };
}

function printRow(r) {
  console.log(
    [
      String(r.concurrency).padStart(5),
      String(r.success).padStart(8),
      String(r.conflict).padStart(9),
      String(r.other).padStart(6),
      String(r.available).padStart(10),
      String(r.p50).padStart(6),
      String(r.p95).padStart(6),
      String(r.p99).padStart(6),
      String(r.wallMs).padStart(8),
      r.oversold ? "OVERSOLD" : r.inventoryOk ? "ok" : "mismatch",
    ].join("  ")
  );
}

async function main() {
  console.log(`Base URL: ${BASE}`);
  console.log(`Tickets per event: ${TICKETS}`);
  console.log(`Concurrency levels: ${LEVELS.join(", ")}`);
  console.log("");

  const health = await json("GET", "/health");
  if (health.status !== 200) {
    throw new Error(`API health check failed: ${JSON.stringify(health)}`);
  }
  console.log(`Health: ${JSON.stringify(health.data)}`);
  console.log("");

  const actors = await setupActors();

  // Correctness probe: 10 tickets, 20 concurrent → expect exactly 10 success
  console.log("--- Correctness probe (10 tickets, 20 concurrent) ---");
  const probe = await runLevel({
    ...actors,
    concurrency: 20,
    tickets: 10,
  });
  console.log(
    `success=${probe.success} conflict=${probe.conflict} available=${probe.available} oversold=${probe.oversold}`
  );
  if (probe.success !== 10 || probe.available !== 0 || probe.oversold) {
    console.error("Correctness probe FAILED — atomic booking not holding.");
    process.exitCode = 1;
  } else {
    console.log("Correctness probe PASSED");
  }
  console.log("");

  console.log("--- Stress levels ---");
  console.log(
    [
      "conc".padStart(5),
      "success".padStart(8),
      "conflict".padStart(9),
      "other".padStart(6),
      "available".padStart(10),
      "p50ms".padStart(6),
      "p95ms".padStart(6),
      "p99ms".padStart(6),
      "wallMs".padStart(8),
      "check",
    ].join("  ")
  );

  const rows = [];
  for (const concurrency of LEVELS) {
    const row = await runLevel({
      ...actors,
      concurrency,
      tickets: TICKETS,
    });
    rows.push(row);
    printRow(row);
  }

  console.log("");
  console.log("JSON_SUMMARY=" + JSON.stringify({ base: BASE, tickets: TICKETS, probe, rows }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
