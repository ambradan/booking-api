import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Idempotent: clear existing data
  await prisma.bookingItem.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.event.deleteMany();

  const events = await Promise.all([
    prisma.event.create({
      data: {
        name: "Rock Festival 2025",
        date: new Date("2025-07-15T20:00:00Z"),
        venue: "Arena di Verona",
        totalSeats: 100,
        availableSeats: 100,
      },
    }),
    prisma.event.create({
      data: {
        name: "Jazz Night",
        date: new Date("2025-06-20T21:00:00Z"),
        venue: "Blue Note Milano",
        totalSeats: 50,
        availableSeats: 50,
      },
    }),
    prisma.event.create({
      data: {
        name: "Tech Conference 2025",
        date: new Date("2025-09-10T09:00:00Z"),
        venue: "MiCo Milano",
        totalSeats: 500,
        availableSeats: 500,
      },
    }),
    prisma.event.create({
      data: {
        name: "Comedy Show - Sold Out Test",
        date: new Date("2025-05-01T19:30:00Z"),
        venue: "Teatro Arcimboldi",
        totalSeats: 5,
        availableSeats: 5,
      },
    }),
    prisma.event.create({
      data: {
        name: "Classical Concert",
        date: new Date("2025-08-25T20:30:00Z"),
        venue: "La Scala",
        totalSeats: 2,
        availableSeats: 2,
      },
    }),
  ]);

  console.log(`Seeded ${events.length} events:`);
  for (const e of events) {
    console.log(`  - ${e.name} (${e.availableSeats} seats) [${e.id}]`);
  }
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
