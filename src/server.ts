import { buildApp } from "./app.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

async function start() {
  const app = await buildApp();

  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`\n🎫 Booking API running at http://${HOST}:${PORT}`);
    console.log(`   Health: http://${HOST}:${PORT}/health`);
    console.log(`   Events: http://${HOST}:${PORT}/api/v1/events`);
    console.log(`   Bookings: http://${HOST}:${PORT}/api/v1/bookings\n`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
