import { Router, Request, Response } from "express";
import db from "../db.js";
import { getSettings, getClosedDates } from "../lib/settings.js";

export const slotsRouter = Router();

slotsRouter.get("/", async (req: Request, res: Response) => {
  const { date, serviceId, clientPhone } = req.query;
  if (!date || !serviceId) {
    res.status(400).json({ error: "date y serviceId son requeridos" });
    return;
  }
  try {
    const cfg = await getSettings();

    /* Comprobar si el día es laborable */
    const reqDate = new Date(`${date}T12:00:00`);
    const jsDay = reqDate.getDay(); // 0=Sun … 6=Sat
    const isoDay = jsDay === 0 ? 7 : jsDay; // 1=Mon … 7=Sun
    if (!cfg.workDays.includes(isoDay)) {
      res.json([]); // día no laborable → sin huecos
      return;
    }

    /* Comprobar si el día está cerrado manualmente */
    const closedDates = await getClosedDates(reqDate.getFullYear(), reqDate.getMonth() + 1);
    if (closedDates.includes(String(date))) {
      res.json([]); // día cerrado → sin huecos
      return;
    }

    const svc = await db.query("SELECT duration FROM services WHERE id = $1", [serviceId]);
    if (svc.rows.length === 0) {
      res.status(404).json({ error: "Servicio no encontrado" });
      return;
    }
    let duration = Number(svc.rows[0].duration);

    if (typeof clientPhone === "string" && clientPhone.trim()) {
      const pref = await db.query(
        `SELECT c.preferred_slot_minutes,
                COUNT(a.id) FILTER (WHERE a.status = 'completed') AS completed_appts
         FROM clients c
         LEFT JOIN appointments a ON a.client_id = c.id
         WHERE c.phone = $1
         GROUP BY c.id`,
        [clientPhone.trim()]
      );
      if (pref.rows.length > 0) {
        const preferred = pref.rows[0].preferred_slot_minutes as number | null;
        const completed = Number(pref.rows[0].completed_appts || 0);
        if (preferred && completed >= 1) duration = preferred;
      }
    }

    const { rows: booked } = await db.query(
      `SELECT start_time, end_time FROM appointments
       WHERE start_time::date = $1 AND status != 'cancelled'`,
      [date]
    );

    const available: string[] = [];
    for (const shift of cfg.shifts) {
      for (let h = shift.start; h < shift.end; h++) {
        for (const m of [0, 15, 30, 45]) {
          const hh = h.toString().padStart(2, "0");
          const mm = m.toString().padStart(2, "0");
          const slotStart = new Date(`${date}T${hh}:${mm}:00`);
          const slotEnd = new Date(slotStart.getTime() + duration * 60_000);
          const shiftEnd = new Date(`${date}T${String(shift.end).padStart(2, "0")}:00:00`);
          if (slotEnd > shiftEnd) continue;
          const overlaps = booked.some((a) => {
            const aStart = new Date(a.start_time);
            const aEnd = new Date(a.end_time);
            return slotStart < aEnd && slotEnd > aStart;
          });
          if (!overlaps) available.push(`${hh}:${mm}`);
        }
      }
    }
    res.json(available);
  } catch {
    res.status(500).json({ error: "Error al calcular huecos" });
  }
});

/* ── GET /api/slots/closed-dates?month=YYYY-MM ── public endpoint ── */
slotsRouter.get("/closed-dates", async (req: Request, res: Response) => {
  const month = req.query.month as string;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month requerido (YYYY-MM)" }); return;
  }
  try {
    const [y, m] = month.split("-").map(Number);
    const dates = await getClosedDates(y, m);
    res.json(dates);
  } catch { res.status(500).json({ error: "Error" }); }
});
