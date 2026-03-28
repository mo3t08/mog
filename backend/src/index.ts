import express from "express";
import cors from "cors";
import { servicesRouter } from "./routes/services.js";
import { slotsRouter } from "./routes/slots.js";
import { appointmentsRouter } from "./routes/appointments.js";
import { barberRouter } from "./routes/barber.js";
import db from "./db.js";
import { notifyAppointmentCreated } from "./lib/notifications.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:3000" }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

app.use("/api/services", servicesRouter);
app.use("/api/slots", slotsRouter);
app.use("/api/appointments", appointmentsRouter);
app.use("/api/barber", barberRouter);

/* ── Reminder cron: every 15 min, send reminders for appts starting in ~24h ── */
async function runReminderCron() {
  try {
    const { rows } = await db.query(
      `SELECT a.id, a.token, a.start_time, a.end_time,
              s.name AS service_name,
              c.name AS client_name, c.phone, c.email, c.opt_in_whatsapp
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN clients  c ON c.id = a.client_id
       WHERE a.status = 'pending'
         AND a.reminder_sent = false
         AND a.start_time BETWEEN NOW() + interval '23 hours' AND NOW() + interval '25 hours'`
    );
    for (const r of rows) {
      try {
        await notifyAppointmentCreated({
          kind: "reminder",
          serviceName: r.service_name,
          startTimeIso: r.start_time,
          endTimeIso: r.end_time,
          token: r.token,
          clientName: r.client_name,
          clientPhone: r.phone,
          clientEmail: r.email || null,
          allowWhatsApp: Boolean(r.opt_in_whatsapp),
        });
        await db.query("UPDATE appointments SET reminder_sent = true WHERE id = $1", [r.id]);
        console.log(`Reminder sent for appt #${r.id} (${r.client_name})`);
      } catch (err) {
        console.error(`Reminder failed for appt #${r.id}:`, err);
      }
    }
  } catch (err) {
    console.error("Reminder cron error:", err);
  }
}

app.listen(PORT, () => {
  console.log(`Backend → :${PORT}`);
  setInterval(runReminderCron, 15 * 60 * 1000); // every 15 min
  runReminderCron(); // run once on start
});
