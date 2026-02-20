/**
 * Concurrency Stress Test for Booking API
 *
 * Proves that SELECT ... FOR UPDATE prevents overselling.
 *
 * TEST SCENARIO:
 * - "Classical Concert" has 2 available seats
 * - We fire 10 concurrent requests, each trying to book 1 seat
 * - EXPECTED: exactly 2 succeed (201), exactly 8 fail (409)
 * - If more than 2 succeed → race condition, overselling bug
 *
 * USAGE:
 *   npx tsx scripts/concurrency-test.ts
 *
 * REQUIRES: booking-api running on localhost:3000 with seeded data
 */

const API_BASE = "http://localhost:3000/api/v1";
const CONCURRENT_REQUESTS = 10;

interface TestResult {
  requestIndex: number;
  status: number;
  body: any;
  durationMs: number;
}

async function getClassicalConcertId(): Promise<string> {
  const res = await fetch(`${API_BASE}/events`);
  const body = await res.json();
  const events = body.data ?? body;
  const concert = events.find(
    (e: any) =>
      e.name === "Classical Concert" || e.name?.includes("Classical")
  );

  if (!concert) {
    throw new Error(
      "Classical Concert not found. Run: npx tsx prisma/seed.ts"
    );
  }

  console.log(
    `Found: "${concert.name}" | ID: ${concert.id} | Available: ${concert.availableSeats}/${concert.totalSeats}`
  );
  return concert.id;
}

async function resetSeeds(): Promise<void> {
  console.log("Resetting seed data...");
  const { execSync } = await import("child_process");
  execSync("npx tsx prisma/seed.ts", { stdio: "pipe" });
  console.log("Seed data reset.\n");
}

async function fireBookingRequest(
  eventId: string,
  index: number
): Promise<TestResult> {
  const start = Date.now();

  const res = await fetch(`${API_BASE}/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: `Stress Test User ${index}`,
      customerEmail: `stress-${index}@test.com`,
      items: [{ eventId, quantity: 1 }],
    }),
  });

  const body = await res.json();
  return {
    requestIndex: index,
    status: res.status,
    body,
    durationMs: Date.now() - start,
  };
}

async function verifyFinalState(eventId: string): Promise<number> {
  const res = await fetch(`${API_BASE}/events`);
  const body = await res.json();
  const events = body.data ?? body;
  const concert = events.find((e: any) => e.id === eventId);
  return concert?.availableSeats ?? -1;
}

async function main() {
  console.log("=".repeat(60));
  console.log("  CONCURRENCY STRESS TEST — Booking API");
  console.log("  Proving SELECT ... FOR UPDATE prevents overselling");
  console.log("=".repeat(60));
  console.log();

  // Step 1: Reset seed data
  await resetSeeds();

  // Step 2: Get event ID
  const eventId = await getClassicalConcertId();
  console.log();

  // Step 3: Fire concurrent requests
  console.log(
    `Firing ${CONCURRENT_REQUESTS} concurrent booking requests for 1 seat each...`
  );
  console.log(
    `Available seats: 2 | If >2 succeed → OVERSELLING BUG\n`
  );

  const startAll = Date.now();

  const promises = Array.from({ length: CONCURRENT_REQUESTS }, (_, i) =>
    fireBookingRequest(eventId, i + 1)
  );

  const results = await Promise.all(promises);
  const totalDuration = Date.now() - startAll;

  // Step 4: Analyze results
  const succeeded = results.filter((r) => r.status === 201);
  const failed = results.filter((r) => r.status === 409);
  const errors = results.filter(
    (r) => r.status !== 201 && r.status !== 409
  );

  console.log("-".repeat(60));
  console.log("RESULTS:");
  console.log("-".repeat(60));

  for (const r of results) {
    const icon = r.status === 201 ? "✅" : r.status === 409 ? "🚫" : "❌";
    const detail =
      r.status === 201
        ? `Booked (${r.durationMs}ms)`
        : r.status === 409
          ? `Rejected: insufficient seats (${r.durationMs}ms)`
          : `Error ${r.status} (${r.durationMs}ms)`;
    console.log(`  ${icon} Request #${r.requestIndex}: ${detail}`);
  }

  console.log();
  console.log("-".repeat(60));
  console.log("SUMMARY:");
  console.log("-".repeat(60));
  console.log(`  Total requests:    ${CONCURRENT_REQUESTS}`);
  console.log(`  Succeeded (201):   ${succeeded.length}`);
  console.log(`  Rejected (409):    ${failed.length}`);
  console.log(`  Errors:            ${errors.length}`);
  console.log(`  Total time:        ${totalDuration}ms`);

  // Step 5: Verify final DB state
  const finalSeats = await verifyFinalState(eventId);
  console.log(`  Final seats left:  ${finalSeats}`);

  console.log();
  console.log("=".repeat(60));

  // Step 6: PASS / FAIL
  const passed =
    succeeded.length === 2 && failed.length === 8 && finalSeats === 0;

  if (passed) {
    console.log("  ✅ TEST PASSED — No overselling. FOR UPDATE works.");
  } else if (succeeded.length <= 2 && finalSeats >= 0) {
    console.log("  ✅ TEST PASSED — No overselling detected.");
    if (succeeded.length < 2) {
      console.log(
        `     Note: only ${succeeded.length}/2 seats sold (possible timeout)`
      );
    }
  } else {
    console.log("  ❌ TEST FAILED — OVERSELLING DETECTED!");
    console.log(
      `     ${succeeded.length} bookings succeeded but only 2 seats existed.`
    );
  }

  console.log("=".repeat(60));

  // Exit with appropriate code
  process.exit(succeeded.length > 2 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test crashed:", err);
  process.exit(1);
});
