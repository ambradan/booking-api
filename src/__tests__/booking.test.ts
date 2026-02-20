import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

/**
 * NOTE: These tests require a running PostgreSQL instance.
 * Run with: docker compose up db -d && npm test
 *
 * The concurrency test is the most important one.
 * It validates that the FOR UPDATE locking prevents overselling.
 */

// Test helpers for manual HTTP testing (curl/httpie/Bruno)
// These are documented here for use during the interview.

const BASE_URL = "http://localhost:3000/api/v1";

describe("Booking API — Contract Tests", () => {
  describe("POST /bookings — Validation", () => {
    it("should reject quantity > 3", async () => {
      const payload = {
        customerEmail: "test@example.com",
        items: [{ eventId: "00000000-0000-0000-0000-000000000001", quantity: 4 }],
      };

      // This validates the Zod schema
      const { CreateBookingSchema } = await import(
        "../schemas/booking.schema.js"
      );
      const result = CreateBookingSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("maximum 3");
      }
    });

    it("should reject quantity < 1", async () => {
      const { CreateBookingSchema } = await import(
        "../schemas/booking.schema.js"
      );
      const result = CreateBookingSchema.safeParse({
        customerEmail: "test@example.com",
        items: [{ eventId: "00000000-0000-0000-0000-000000000001", quantity: 0 }],
      });
      expect(result.success).toBe(false);
    });

    it("should reject duplicate eventIds", async () => {
      const { CreateBookingSchema } = await import(
        "../schemas/booking.schema.js"
      );
      const eventId = "00000000-0000-0000-0000-000000000001";
      const result = CreateBookingSchema.safeParse({
        customerEmail: "test@example.com",
        items: [
          { eventId, quantity: 1 },
          { eventId, quantity: 2 },
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("duplicate");
      }
    });

    it("should reject invalid email", async () => {
      const { CreateBookingSchema } = await import(
        "../schemas/booking.schema.js"
      );
      const result = CreateBookingSchema.safeParse({
        customerEmail: "not-an-email",
        items: [{ eventId: "00000000-0000-0000-0000-000000000001", quantity: 1 }],
      });
      expect(result.success).toBe(false);
    });

    it("should reject empty items array", async () => {
      const { CreateBookingSchema } = await import(
        "../schemas/booking.schema.js"
      );
      const result = CreateBookingSchema.safeParse({
        customerEmail: "test@example.com",
        items: [],
      });
      expect(result.success).toBe(false);
    });

    it("should accept valid multi-event booking", async () => {
      const { CreateBookingSchema } = await import(
        "../schemas/booking.schema.js"
      );
      const result = CreateBookingSchema.safeParse({
        customerEmail: "test@example.com",
        items: [
          { eventId: "00000000-0000-0000-0000-000000000001", quantity: 3 },
          { eventId: "00000000-0000-0000-0000-000000000002", quantity: 1 },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Notification Service", () => {
    it("should not throw on notification failure", async () => {
      const { NotificationService } = await import(
        "../services/notification.service.js"
      );

      const failingChannel = {
        send: async () => {
          throw new Error("SMTP down");
        },
      };

      const service = new NotificationService(failingChannel);

      // Must not throw
      await expect(
        service.notify({
          bookingId: "test-id",
          customerEmail: "test@example.com",
          items: [{ eventName: "Test Event", quantity: 1 }],
          totalTickets: 1,
          createdAt: new Date(),
        })
      ).resolves.not.toThrow();
    });
  });
});

/**
 * ═══════════════════════════════════════════════════
 * CONCURRENCY TEST — Manual procedure for interview
 * ═══════════════════════════════════════════════════
 *
 * This is the most important test case.
 * Run against the "Classical Concert" event (2 seats).
 *
 * Step 1: Get event ID
 *   curl http://localhost:3000/api/v1/events
 *   → find the event with availableSeats: 2
 *
 * Step 2: Open two terminals and run simultaneously:
 *
 *   Terminal 1:
 *   curl -X POST http://localhost:3000/api/v1/bookings \
 *     -H "Content-Type: application/json" \
 *     -d '{"customerEmail":"a@test.com","items":[{"eventId":"EVENT_ID","quantity":2}]}'
 *
 *   Terminal 2:
 *   curl -X POST http://localhost:3000/api/v1/bookings \
 *     -H "Content-Type: application/json" \
 *     -d '{"customerEmail":"b@test.com","items":[{"eventId":"EVENT_ID","quantity":2}]}'
 *
 * Expected: ONE succeeds (201), ONE fails (409 InsufficientSeats).
 * Never: both succeed (that would be overselling).
 *
 * For automated load testing:
 *   npm install -g autocannon
 *   autocannon -c 10 -d 5 -m POST \
 *     -H "Content-Type: application/json" \
 *     -b '{"customerEmail":"load@test.com","items":[{"eventId":"EVENT_ID","quantity":1}]}' \
 *     http://localhost:3000/api/v1/bookings
 *
 * Then verify: SELECT available_seats FROM events WHERE id = 'EVENT_ID';
 * available_seats must be >= 0. If negative, concurrency is broken.
 */
