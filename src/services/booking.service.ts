import { PrismaClient, Prisma } from "@prisma/client";
import { CreateBookingInput } from "../schemas/booking.schema.js";
import {
  NotificationService,
  BookingNotification,
} from "./notification.service.js";

/**
 * Custom error types for precise error handling in routes.
 * Each maps to a specific HTTP status code.
 */
export class EventNotFoundError extends Error {
  constructor(public eventId: string) {
    super(`Event not found: ${eventId}`);
    this.name = "EventNotFoundError";
  }
}

export class InsufficientSeatsError extends Error {
  constructor(
    public eventId: string,
    public requested: number,
    public available: number
  ) {
    super(
      `Insufficient seats for event ${eventId}: requested ${requested}, available ${available}`
    );
    this.name = "InsufficientSeatsError";
  }
}

export class BookingNotFoundError extends Error {
  constructor(public bookingId: string) {
    super(`Booking not found: ${bookingId}`);
    this.name = "BookingNotFoundError";
  }
}

export class BookingAlreadyCancelledError extends Error {
  constructor(public bookingId: string) {
    super(`Booking already cancelled: ${bookingId}`);
    this.name = "BookingAlreadyCancelledError";
  }
}

interface BookingResult {
  id: string;
  customerEmail: string;
  status: string;
  createdAt: Date;
  items: Array<{
    eventId: string;
    eventName: string;
    quantity: number;
  }>;
  totalTickets: number;
}

/**
 * Transaction configuration.
 *
 * TIMEOUT: 5 seconds. If a transaction takes longer (e.g. deadlock,
 * slow query, network issue), it's rolled back automatically.
 * Without this, a hung transaction holds row locks indefinitely.
 *
 * ISOLATION: ReadCommitted (PostgreSQL default). Sufficient for
 * our use case because FOR UPDATE provides the serialization
 * we need at the row level.
 */
const TRANSACTION_OPTIONS = {
  timeout: 5000,
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
} as const;

export class BookingService {
  private notificationService: NotificationService;

  constructor(
    private prisma: PrismaClient,
    notificationService?: NotificationService
  ) {
    this.notificationService =
      notificationService ?? new NotificationService();
  }

  /**
   * Create a booking atomically.
   *
   * CRITICAL DESIGN:
   * - Uses raw SQL with SELECT ... FOR UPDATE to prevent race conditions.
   * - All seat checks and decrements happen inside a single DB transaction.
   * - If ANY event fails (not found, insufficient seats), the ENTIRE
   *   transaction rolls back. No partial bookings.
   *
   * CONCURRENCY MODEL:
   * Row-level locking via FOR UPDATE ensures that concurrent requests
   * for the same event are serialized at the database level.
   * This is the correct solution — not application-level mutexes,
   * not optimistic locking with retries.
   *
   * IDEMPOTENCY:
   * If an idempotencyKey is provided, the service checks for an existing
   * booking with that key before creating a new one. If found, returns
   * the existing booking. This prevents duplicate bookings on client retry.
   */
  async createBooking(
    input: CreateBookingInput,
    idempotencyKey?: string
  ): Promise<BookingResult> {
    // Idempotency check: if key was seen before, return existing booking
    if (idempotencyKey) {
      const existing = await this.prisma.booking.findUnique({
        where: { idempotencyKey },
        include: { items: { include: { event: true } } },
      });

      if (existing) {
        return {
          id: existing.id,
          customerEmail: existing.customerEmail,
          status: existing.status,
          createdAt: existing.createdAt,
          items: existing.items.map((item) => ({
            eventId: item.eventId,
            eventName: item.event.name,
            quantity: item.quantity,
          })),
          totalTickets: existing.items.reduce(
            (sum, item) => sum + item.quantity,
            0
          ),
        };
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Phase 1: Lock and validate all events
      const eventDetails: Array<{
        id: string;
        name: string;
        availableSeats: number;
        requestedQuantity: number;
      }> = [];

      for (const item of input.items) {
        // SELECT ... FOR UPDATE: acquires row-level lock
        const events = await tx.$queryRaw<
          Array<{ id: string; name: string; available_seats: number }>
        >`
          SELECT id, name, available_seats
          FROM events
          WHERE id = ${item.eventId}
          FOR UPDATE
        `;

        if (events.length === 0) {
          throw new EventNotFoundError(item.eventId);
        }

        const event = events[0];

        if (event.available_seats < item.quantity) {
          throw new InsufficientSeatsError(
            item.eventId,
            item.quantity,
            event.available_seats
          );
        }

        eventDetails.push({
          id: event.id,
          name: event.name,
          availableSeats: event.available_seats,
          requestedQuantity: item.quantity,
        });
      }

      // Phase 2: Decrement seats (still inside the same transaction)
      for (const detail of eventDetails) {
        await tx.$executeRaw`
          UPDATE events
          SET available_seats = available_seats - ${detail.requestedQuantity},
              updated_at = NOW()
          WHERE id = ${detail.id}
        `;
      }

      // Phase 3: Create booking record
      const booking = await tx.booking.create({
        data: {
          customerEmail: input.customerEmail,
          ...(idempotencyKey && { idempotencyKey }),
          items: {
            create: input.items.map((item) => ({
              eventId: item.eventId,
              quantity: item.quantity,
            })),
          },
        },
        include: {
          items: true,
        },
      });

      return {
        booking,
        eventDetails,
      };
    }, TRANSACTION_OPTIONS);

    // Phase 4: Notification (outside transaction — fire and forget)
    const bookingResult: BookingResult = {
      id: result.booking.id,
      customerEmail: result.booking.customerEmail,
      status: result.booking.status,
      createdAt: result.booking.createdAt,
      items: result.eventDetails.map((detail, i) => ({
        eventId: detail.id,
        eventName: detail.name,
        quantity: result.booking.items[i].quantity,
      })),
      totalTickets: result.booking.items.reduce(
        (sum, item) => sum + item.quantity,
        0
      ),
    };

    // Non-blocking notification
    this.notificationService
      .notify({
        bookingId: bookingResult.id,
        customerEmail: bookingResult.customerEmail,
        items: bookingResult.items.map((i) => ({
          eventName: i.eventName,
          quantity: i.quantity,
        })),
        totalTickets: bookingResult.totalTickets,
        createdAt: bookingResult.createdAt,
      })
      .catch(() => {
        /* already handled inside NotificationService */
      });

    return bookingResult;
  }

  /**
   * Cancel a booking and restore seats.
   * Same locking pattern: FOR UPDATE on events to prevent race conditions.
   */
  async cancelBooking(bookingId: string): Promise<BookingResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { items: { include: { event: true } } },
      });

      if (!booking) {
        throw new BookingNotFoundError(bookingId);
      }

      if (booking.status === "CANCELLED") {
        throw new BookingAlreadyCancelledError(bookingId);
      }

      // Lock events and restore seats
      for (const item of booking.items) {
        await tx.$executeRaw`
          UPDATE events
          SET available_seats = available_seats + ${item.quantity},
              updated_at = NOW()
          WHERE id = ${item.eventId}
        `;
      }

      // Mark booking as cancelled
      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: { status: "CANCELLED" },
        include: { items: { include: { event: true } } },
      });

      return updated;
    }, TRANSACTION_OPTIONS);

    return {
      id: result.id,
      customerEmail: result.customerEmail,
      status: result.status,
      createdAt: result.createdAt,
      items: result.items.map((item) => ({
        eventId: item.eventId,
        eventName: item.event.name,
        quantity: item.quantity,
      })),
      totalTickets: result.items.reduce((sum, item) => sum + item.quantity, 0),
    };
  }

  /**
   * Get a single booking by ID.
   */
  async getBooking(bookingId: string): Promise<BookingResult> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { items: { include: { event: true } } },
    });

    if (!booking) {
      throw new BookingNotFoundError(bookingId);
    }

    return {
      id: booking.id,
      customerEmail: booking.customerEmail,
      status: booking.status,
      createdAt: booking.createdAt,
      items: booking.items.map((item) => ({
        eventId: item.eventId,
        eventName: item.event.name,
        quantity: item.quantity,
      })),
      totalTickets: booking.items.reduce(
        (sum, item) => sum + item.quantity,
        0
      ),
    };
  }

  /**
   * List all bookings, optionally filtered by email.
   */
  async listBookings(
    filters?: { email?: string; status?: string },
    pagination?: { page?: number; limit?: number }
  ) {
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.BookingWhereInput = {};
    if (filters?.email) where.customerEmail = filters.email;
    if (filters?.status)
      where.status = filters.status as Prisma.EnumBookingStatusFilter;

    const [bookings, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include: { items: { include: { event: true } } },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.booking.count({ where }),
    ]);

    return {
      data: bookings.map((booking) => ({
        id: booking.id,
        customerEmail: booking.customerEmail,
        status: booking.status,
        createdAt: booking.createdAt,
        items: booking.items.map((item) => ({
          eventId: item.eventId,
          eventName: item.event.name,
          quantity: item.quantity,
        })),
        totalTickets: booking.items.reduce(
          (sum, item) => sum + item.quantity,
          0
        ),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
