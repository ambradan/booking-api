/**
 * Notification service with Strategy pattern.
 * DESIGN DECISION: decoupled from booking logic.
 * Current implementation: console log (simulated).
 * Extensible to: email (nodemailer), SMS (Twilio), webhook, etc.
 */

export interface BookingNotification {
  bookingId: string;
  customerEmail: string;
  items: Array<{
    eventName: string;
    quantity: number;
  }>;
  totalTickets: number;
  createdAt: Date;
}

export interface NotificationChannel {
  send(notification: BookingNotification): Promise<void>;
}

/**
 * Console channel: logs the notification.
 * Used for development and as proof of concept.
 */
export class ConsoleNotificationChannel implements NotificationChannel {
  async send(notification: BookingNotification): Promise<void> {
    console.log("\n📧 ─── BOOKING CONFIRMATION ───");
    console.log(`  Booking ID: ${notification.bookingId}`);
    console.log(`  Email: ${notification.customerEmail}`);
    console.log(`  Items:`);
    for (const item of notification.items) {
      console.log(`    • ${item.eventName} × ${item.quantity}`);
    }
    console.log(`  Total tickets: ${notification.totalTickets}`);
    console.log(`  Date: ${notification.createdAt.toISOString()}`);
    console.log("─────────────────────────────\n");
  }
}

/**
 * Notification service: dispatches to configured channel.
 * Fire-and-forget: notification failure must NOT roll back booking.
 */
export class NotificationService {
  private channel: NotificationChannel;

  constructor(channel?: NotificationChannel) {
    this.channel = channel ?? new ConsoleNotificationChannel();
  }

  async notify(notification: BookingNotification): Promise<void> {
    try {
      await this.channel.send(notification);
    } catch (error) {
      // DESIGN: notification failure is logged, never propagated.
      // A booking is valid regardless of notification delivery.
      console.error("Notification failed (non-blocking):", error);
    }
  }
}
