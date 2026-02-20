# Booking API

Event ticket booking service with atomic multi-event transactions.

## Architecture Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Runtime | Node.js + TypeScript | Type safety, ecosystem maturity |
| Framework | Fastify | Native schema validation, superior performance to Express |
| Database | PostgreSQL | ACID transactions, row-level locking (`FOR UPDATE`) for concurrency |
| ORM | Prisma | Type-safe queries, versionable migrations, scriptable seed |
| Validation | Zod | Runtime type validation, composable schemas |
| Containerization | Docker Compose | Zero-friction setup, reproducible environment |

### Why these matter

The core challenge of this system is **concurrency control on seat availability**. When two users simultaneously try to book the last seat, the system must guarantee exactly one succeeds. This requires:

1. **Row-level locking** (`SELECT ... FOR UPDATE`) — PostgreSQL provides this natively
2. **Atomic transactions** — all seat checks and decrements happen in a single DB transaction
3. **All-or-nothing semantics** — if booking 3 events and event #2 has insufficient seats, all 3 are rolled back

SQLite lacks row-level locking. MongoDB lacks reliable multi-document transactions for this pattern. PostgreSQL is the correct choice for this problem.

## Quick Start

```bash
# Clone and start
git clone <repo-url>
cd booking-api
cp .env.example .env

# Option 1: Docker (recommended)
docker compose up -d
# Wait for DB health check, then:
docker compose exec app npx prisma migrate deploy
docker compose exec app npx tsx prisma/seed.ts

# Option 2: Local (requires PostgreSQL running)
npm install
npx prisma migrate dev
npx tsx prisma/seed.ts
npm run dev
```

The API will be available at `http://localhost:3000`.

## API Reference

### Health Check

```
GET /health
```

### Events

```
GET /api/v1/events          # List all events
GET /api/v1/events/:id      # Get single event
```

### Bookings

```
POST /api/v1/bookings               # Create booking
GET  /api/v1/bookings               # List bookings (?email=&status=&page=&limit=)
GET  /api/v1/bookings/:id           # Get single booking
POST /api/v1/bookings/:id/cancel    # Cancel booking (restores seats)
```

### Create Booking — Request

```json
POST /api/v1/bookings
{
  "customerEmail": "user@example.com",
  "items": [
    { "eventId": "uuid-1", "quantity": 2 },
    { "eventId": "uuid-2", "quantity": 1 }
  ]
}
```

**Constraints:**
- Max 3 tickets per event per transaction
- No duplicate events in the same transaction
- All events must have sufficient available seats
- Transaction is atomic: all succeed or all fail

### Error Responses

| Status | Error | When |
|--------|-------|------|
| 400 | `ValidationError` | Invalid input (bad email, quantity > 3, etc.) |
| 404 | `EventNotFound` | Event ID doesn't exist |
| 404 | `BookingNotFound` | Booking ID doesn't exist |
| 409 | `InsufficientSeats` | Not enough seats available |
| 409 | `BookingAlreadyCancelled` | Booking was already cancelled |

## Project Structure

```
booking-api/
├── prisma/
│   ├── schema.prisma          # Data model
│   ├── seed.ts                # Test data
│   └── migrations/            # Versioned migrations
├── src/
│   ├── app.ts                 # Fastify app factory
│   ├── server.ts              # Entry point
│   ├── plugins/
│   │   └── prisma.ts          # DB connection plugin
│   ├── routes/
│   │   ├── event.routes.ts    # GET /events
│   │   ├── booking.routes.ts  # POST/GET /bookings
│   │   └── health.routes.ts   # GET /health
│   ├── services/
│   │   ├── booking.service.ts # Core business logic
│   │   └── notification.service.ts  # Notification (simulated)
│   ├── schemas/
│   │   └── booking.schema.ts  # Zod validation
│   └── __tests__/
│       └── ...
├── docker-compose.yml
├── Dockerfile
└── README.md
```

## Concurrency Model

```
Request A: book 2 seats for Event X
Request B: book 2 seats for Event X (concurrent)
Event X has 3 available seats.

Timeline:
1. A: BEGIN
2. A: SELECT ... FROM events WHERE id='X' FOR UPDATE  → locks row
3. B: BEGIN
4. B: SELECT ... FROM events WHERE id='X' FOR UPDATE  → BLOCKS (waits for A)
5. A: sees 3 available, decrements to 1
6. A: COMMIT → lock released
7. B: unblocks, sees 1 available, requested 2 → InsufficientSeatsError
8. B: ROLLBACK
```

No race condition. No overselling. Guaranteed by PostgreSQL row-level locking.

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

## Development

```bash
npm run dev           # Start with hot reload
npm run typecheck     # Type check without emitting
npm run lint          # Lint
npm run db:studio     # Prisma Studio (DB GUI)
```
