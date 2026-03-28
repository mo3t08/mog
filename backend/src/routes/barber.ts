import { Router, Request, Response } from "express";
import type { PoolClient } from "pg";
import crypto from "crypto";
import db from "../db.js";
import { getDefaultTestDestinations, notifyAppointmentCreated, sendTestNotifications } from "../lib/notifications.js";
import { getSettings, getClosedDates, invalidateSettingsCache } from "../lib/settings.js";

export const barberRouter = Router();

async function autoCompleteElapsedAppointments() {
  await db.query(
    `UPDATE appointments
     SET status = 'completed'
     WHERE status = 'pending'
       AND end_time < NOW()`
  );
}

const APPT_SELECT = `
  SELECT a.id, a.status, a.start_time, a.end_time, a.token,
         s.id AS service_id, s.name AS service_name,
         CAST(EXTRACT(EPOCH FROM (a.end_time - a.start_time)) / 60 AS integer) AS duration,
         s.price,
         c.id AS client_id, c.name AS client_name, c.phone, c.email, c.observations, c.preferred_slot_minutes
  FROM appointments a
  JOIN services s ON s.id = a.service_id
  JOIN clients  c ON c.id = a.client_id
`;

async function resolveEffectiveDuration(
  conn: PoolClient,
  clientId: number,
  serviceDuration: number
) {
  const pref = await conn.query(
    `SELECT c.preferred_slot_minutes,
            COUNT(a.id) FILTER (WHERE a.status = 'completed') AS completed_appts
     FROM clients c
     LEFT JOIN appointments a ON a.client_id = c.id
     WHERE c.id = $1
     GROUP BY c.id`,
    [clientId]
  );
  if (pref.rows.length === 0) return serviceDuration;

  const preferred = pref.rows[0].preferred_slot_minutes as number | null;
  const completed = Number(pref.rows[0].completed_appts || 0);
  if (preferred && completed >= 1) return preferred;
  return serviceDuration;
}

/* ── GET /api/barber/agenda?date=YYYY-MM-DD ── */
barberRouter.get("/agenda", async (req: Request, res: Response) => {
  const { date } = req.query;
  if (!date) { res.status(400).json({ error: "date es requerido" }); return; }
  try {
    await autoCompleteElapsedAppointments();
    const { rows } = await db.query(
      APPT_SELECT + " WHERE a.start_time::date = $1 ORDER BY a.start_time",
      [date]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: "Error al obtener agenda" }); }
});

/* ── GET /api/barber/appointments?from=&to=&status= ── */
barberRouter.get("/appointments", async (req: Request, res: Response) => {
  const { from, to, status } = req.query as Record<string, string>;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (from) { conditions.push(`a.start_time::date >= $${idx++}`); params.push(from); }
  if (to)   { conditions.push(`a.start_time::date <= $${idx++}`); params.push(to); }
  if (status && status !== "all") { conditions.push(`a.status = $${idx++}`); params.push(status); }
  const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
  try {
    await autoCompleteElapsedAppointments();
    const { rows } = await db.query(APPT_SELECT + where + " ORDER BY a.start_time DESC", params);
    res.json(rows);
  } catch { res.status(500).json({ error: "Error al obtener citas" }); }
});

/* ── GET /api/barber/stats?from=&to= ── */
barberRouter.get("/stats", async (req: Request, res: Response) => {
  const { from, to } = req.query as Record<string, string>;
  const params: unknown[] = [];
  let idx = 1;
  const dateCond = [];
  if (from) { dateCond.push(`a.start_time::date >= $${idx++}`); params.push(from); }
  if (to)   { dateCond.push(`a.start_time::date <= $${idx++}`); params.push(to); }
  const where = dateCond.length ? "WHERE " + dateCond.join(" AND ") : "";
  const whereWithStatus = dateCond.length
    ? `WHERE ${dateCond.join(" AND ")} AND a.status IN ('pending', 'no_show', 'cancelled')`
    : "WHERE a.status IN ('pending', 'no_show', 'cancelled')";
  try {
    await autoCompleteElapsedAppointments();
    const [totals, byService, byDay, statusDetails] = await Promise.all([
      db.query(
        `SELECT
           COUNT(*) FILTER (WHERE a.status != 'cancelled') AS total,
           COUNT(*) FILTER (WHERE a.status = 'pending')   AS pending,
           COUNT(*) FILTER (WHERE a.status = 'completed') AS completed,
           COUNT(*) FILTER (WHERE a.status = 'no_show')   AS no_show,
           COUNT(*) FILTER (WHERE a.status = 'cancelled') AS cancelled,
           COALESCE(SUM(s.price) FILTER (WHERE a.status = 'completed'), 0) AS revenue
         FROM appointments a JOIN services s ON s.id = a.service_id ${where}`,
        params
      ),
      db.query(
        `SELECT s.name AS service_name,
                COUNT(*) FILTER (WHERE a.status != 'cancelled') AS count,
                COALESCE(SUM(s.price) FILTER (WHERE a.status = 'completed'), 0) AS revenue
         FROM appointments a JOIN services s ON s.id = a.service_id ${where}
         GROUP BY s.name ORDER BY count DESC`,
        params
      ),
      db.query(
        `SELECT a.start_time::date AS day,
                COUNT(*) FILTER (WHERE a.status != 'cancelled') AS count,
                COALESCE(SUM(s.price) FILTER (WHERE a.status = 'completed'), 0) AS revenue
         FROM appointments a JOIN services s ON s.id = a.service_id ${where}
         GROUP BY day ORDER BY day`,
        params
      ),
      db.query(
        `SELECT a.status, a.start_time, c.name AS client_name, c.phone, s.name AS service_name
         FROM appointments a
         JOIN clients c ON c.id = a.client_id
         JOIN services s ON s.id = a.service_id
         ${whereWithStatus}
         ORDER BY a.start_time DESC
         LIMIT 120`,
        params
      ),
    ]);

    const noShowList = statusDetails.rows.filter((r: { status: string }) => r.status === "no_show").slice(0, 20);
    const pendingList = statusDetails.rows.filter((r: { status: string }) => r.status === "pending").slice(0, 20);
    const cancelledList = statusDetails.rows.filter((r: { status: string }) => r.status === "cancelled").slice(0, 20);

    res.json({
      totals: totals.rows[0],
      byService: byService.rows,
      byDay: byDay.rows,
      noShowList,
      pendingList,
      cancelledList,
    });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error stats" }); }
});

/* ── GET /api/barber/clients ── */
barberRouter.get("/clients", async (_req: Request, res: Response) => {
  try {
    await autoCompleteElapsedAppointments();
    const { rows } = await db.query(
      `SELECT c.id, c.name, c.phone, c.email, c.opt_in_whatsapp, c.created_at,
              c.observations, c.preferred_slot_minutes,
              COUNT(a.id) AS total_appts,
              COUNT(a.id) FILTER (WHERE a.status = 'completed') AS completed_appts,
              COUNT(a.id) FILTER (WHERE a.status = 'no_show') AS no_show_appts,
              MAX(a.start_time) AS last_appt
       FROM clients c
       LEFT JOIN appointments a ON a.client_id = c.id AND a.status != 'cancelled'
       GROUP BY c.id ORDER BY c.name`
    );
    res.json(rows);
  } catch { res.status(500).json({ error: "Error clientes" }); }
});

/* ── DELETE /api/barber/clients/:id ── borrar cliente + citas ── */
barberRouter.delete("/clients/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Cliente inválido" });
    return;
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const exists = await client.query("SELECT id, name FROM clients WHERE id = $1", [id]);
    if (exists.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Cliente no encontrado" });
      return;
    }

    await client.query("DELETE FROM appointments WHERE client_id = $1", [id]);
    await client.query("DELETE FROM clients WHERE id = $1", [id]);
    await client.query("COMMIT");

    res.json({ ok: true, id, name: exists.rows[0].name });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ error: "Error al borrar cliente" });
  } finally {
    client.release();
  }
});

/* ── PATCH /api/barber/clients/:id ── editar datos de cliente ── */
barberRouter.patch("/clients/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Cliente inválido" }); return;
  }
  const { name, phone, email, observations, preferredSlotMinutes } = req.body as {
    name: string;
    phone: string;
    email?: string;
    observations?: string;
    preferredSlotMinutes?: number | null;
  };
  if (!name?.trim() || !phone?.trim()) {
    res.status(400).json({ error: "Nombre y teléfono son obligatorios" }); return;
  }
  const pref = preferredSlotMinutes == null ? null : Number(preferredSlotMinutes);
  if (pref !== null && ![15, 30, 45, 60].includes(pref)) {
    res.status(400).json({ error: "Duración preferida inválida" }); return;
  }
  try {
    const r = await db.query(
      "UPDATE clients SET name=$1, phone=$2, email=$3, observations=$4, preferred_slot_minutes=$5 WHERE id=$6 RETURNING id",
      [name.trim(), phone.trim(), email?.trim() || null, observations?.trim() || null, pref, id]
    );
    if (r.rowCount === 0) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error actualizando cliente" });
  }
});

/* ── PATCH /api/barber/appointments/:id ── marcar estado ── */
barberRouter.patch("/appointments/:id", async (req: Request, res: Response) => {
  const { status } = req.body;
  const id = parseInt(req.params.id, 10);
  if (!["completed", "no_show", "pending", "cancelled"].includes(status)) {
    res.status(400).json({ error: "Estado inválido" }); return;
  }
  try {
    const result = await db.query(
      "UPDATE appointments SET status = $1 WHERE id = $2 RETURNING id, status, token, start_time, end_time, service_id, client_id",
      [status, id]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: "Cita no encontrada" }); return; }

    const details = await db.query(
      `SELECT s.name AS service_name,
              c.name AS client_name,
              c.phone,
              c.email,
              c.opt_in_whatsapp
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN clients c ON c.id = a.client_id
       WHERE a.id = $1`,
      [id]
    );

    if (details.rows.length > 0) {
      const kind = status === "cancelled" ? "cancelled" : status === "completed" ? "confirmed" : "updated";
      void notifyAppointmentCreated({
        kind,
        serviceName: details.rows[0].service_name,
        startTimeIso: result.rows[0].start_time,
        endTimeIso: result.rows[0].end_time,
        token: result.rows[0].token,
        clientName: details.rows[0].client_name,
        clientPhone: details.rows[0].phone,
        clientEmail: details.rows[0].email || null,
        allowWhatsApp: Boolean(details.rows[0].opt_in_whatsapp),
      });
    }

    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: "Error al actualizar" }); }
});

/* ── POST /api/barber/appointments/:id/notify ── recordatorio manual ── */
barberRouter.post("/appointments/:id/notify", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { useTestDestinations = true } = req.body as { useTestDestinations?: boolean };
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Cita inválida" });
    return;
  }
  try {
    const details = await db.query(
      `SELECT a.id, a.token, a.start_time, a.end_time,
              s.name AS service_name,
              c.name AS client_name,
              c.phone,
              c.email,
              c.opt_in_whatsapp
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN clients c ON c.id = a.client_id
       WHERE a.id = $1`,
      [id]
    );
    if (details.rows.length === 0) {
      res.status(404).json({ error: "Cita no encontrada" });
      return;
    }

    const item = details.rows[0];
    const testDestinations = getDefaultTestDestinations();
    const emailToUse = useTestDestinations ? testDestinations.email : (item.email || null);
    const phoneToUse = useTestDestinations ? testDestinations.phone : item.phone;
    const allowWhatsApp = useTestDestinations ? Boolean(phoneToUse) : Boolean(item.opt_in_whatsapp);

    const notifyResult = await notifyAppointmentCreated({
      kind: "reminder",
      serviceName: item.service_name,
      startTimeIso: item.start_time,
      endTimeIso: item.end_time,
      token: item.token,
      clientName: item.client_name,
      clientPhone: phoneToUse,
      clientEmail: emailToUse,
      allowWhatsApp,
    });
    res.json({ ok: true, mode: useTestDestinations ? "test-destinations" : "client-destinations", result: notifyResult });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al enviar recordatorio" });
  }
});

/* ── POST /api/barber/notifications/test ── prueba envíos ── */
barberRouter.post("/notifications/test", async (req: Request, res: Response) => {
  const { email, phone } = req.body as { email?: string; phone?: string };
  try {
    const result = await sendTestNotifications({ email, phone });
    res.json({ ok: true, result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error enviando pruebas" });
  }
});

/* ── Helpers ── */
const pad = (n: number) => n.toString().padStart(2, "0");
const fmtLocal = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/* ── GET /api/barber/settings ── */
barberRouter.get("/settings", async (_req: Request, res: Response) => {
  try {
    const cfg = await getSettings();
    res.json(cfg);
  } catch (e) { console.error(e); res.status(500).json({ error: "Error settings" }); }
});

/* ── PUT /api/barber/settings ── */
barberRouter.put("/settings", async (req: Request, res: Response) => {
  const { shifts, workDays } = req.body as {
    shifts?: { start: number; end: number }[];
    workDays?: number[];
  };
  const conn = await db.connect();
  try {
    await conn.query("BEGIN");
    if (shifts && Array.isArray(shifts)) {
      const s1 = shifts[0];
      const s2 = shifts[1];
      if (s1 && Number.isInteger(s1.start) && Number.isInteger(s1.end)) {
        await conn.query("INSERT INTO settings (key,value) VALUES ('shift1_start',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [String(s1.start)]);
        await conn.query("INSERT INTO settings (key,value) VALUES ('shift1_end',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [String(s1.end)]);
      }
      if (s2 && Number.isInteger(s2.start) && Number.isInteger(s2.end)) {
        await conn.query("INSERT INTO settings (key,value) VALUES ('shift2_start',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [String(s2.start)]);
        await conn.query("INSERT INTO settings (key,value) VALUES ('shift2_end',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [String(s2.end)]);
      }
    }
    if (workDays && Array.isArray(workDays) && workDays.every(d => Number.isInteger(d) && d >= 1 && d <= 7)) {
      await conn.query("INSERT INTO settings (key,value) VALUES ('work_days',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [workDays.join(",")]);
    }
    await conn.query("COMMIT");
    invalidateSettingsCache();
    const cfg = await getSettings();
    res.json(cfg);
  } catch (e) { await conn.query("ROLLBACK").catch(() => {}); console.error(e); res.status(500).json({ error: "Error guardando settings" }); }
  finally { conn.release(); }
});

/* ── GET /api/barber/closed-dates?month=YYYY-MM ── */
barberRouter.get("/closed-dates", async (req: Request, res: Response) => {
  const month = req.query.month as string;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month requerido (YYYY-MM)" }); return;
  }
  try {
    const [y, m] = month.split("-").map(Number);
    const dates = await getClosedDates(y, m);

    // For each closed date, count affected appointments
    const firstDay = `${month}-01`;
    const lastDay = new Date(y, m, 0).toISOString().slice(0, 10);
    const { rows: apptCounts } = await db.query(
      `SELECT TO_CHAR(start_time::date, 'YYYY-MM-DD') AS date, COUNT(*) AS count
       FROM appointments
       WHERE status NOT IN ('cancelled','completed')
         AND start_time::date >= $1 AND start_time::date <= $2
       GROUP BY start_time::date`,
      [firstDay, lastDay]
    );
    const countMap: Record<string, number> = {};
    for (const r of apptCounts) countMap[r.date] = Number(r.count);

    res.json({ closedDates: dates, apptCounts: countMap });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error" }); }
});

/* ── POST /api/barber/closed-dates ── cerrar un día ── */
barberRouter.post("/closed-dates", async (req: Request, res: Response) => {
  const { date, reason } = req.body as { date: string; reason?: string };
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "date requerido (YYYY-MM-DD)" }); return;
  }
  try {
    await db.query(
      "INSERT INTO closed_dates (date, reason) VALUES ($1, $2) ON CONFLICT (date) DO UPDATE SET reason = $2",
      [date, reason?.trim() || ""]
    );
    // Return affected appointments for that day
    const { rows: affected } = await db.query(
      `SELECT a.id, a.start_time, a.end_time, a.token,
              s.name AS service_name,
              c.name AS client_name, c.phone, c.email
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN clients  c ON c.id = a.client_id
       WHERE a.status NOT IN ('cancelled','completed')
         AND a.start_time::date = $1
       ORDER BY a.start_time`,
      [date]
    );
    res.json({ ok: true, date, affectedAppointments: affected });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error al cerrar día" }); }
});

/* ── DELETE /api/barber/closed-dates/:date ── reabrir un día ── */
barberRouter.delete("/closed-dates/:date", async (req: Request, res: Response) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "Fecha inválida" }); return;
  }
  try {
    await db.query("DELETE FROM closed_dates WHERE date = $1", [date]);
    res.json({ ok: true, date });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error" }); }
});

/* ── POST /api/barber/closed-dates/:date/notify ── notificar clientes (WhatsApp) de día cerrado ── */
barberRouter.post("/closed-dates/:date/notify", async (req: Request, res: Response) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "Fecha inválida" }); return;
  }
  const { useTestDestinations = true } = req.body as { useTestDestinations?: boolean };
  const testDest = getDefaultTestDestinations();
  try {
    const { rows: appts } = await db.query(
      `SELECT a.id, a.start_time, a.end_time, a.token,
              s.name AS service_name,
              c.name AS client_name, c.phone, c.email, c.opt_in_whatsapp
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN clients  c ON c.id = a.client_id
       WHERE a.status NOT IN ('cancelled','completed')
         AND a.start_time::date = $1
       ORDER BY a.start_time`,
      [date]
    );

    const results: { id: number; client_name: string; whatsapp: string; email: string }[] = [];
    for (const a of appts) {
      const phone = useTestDestinations ? testDest.phone : a.phone;
      const email = useTestDestinations ? testDest.email : (a.email || null);
      const allowWA = useTestDestinations ? Boolean(phone) : Boolean(a.opt_in_whatsapp);
      const r = await notifyAppointmentCreated({
        kind: "cancelled",
        serviceName: a.service_name,
        startTimeIso: a.start_time,
        endTimeIso: a.end_time,
        token: a.token,
        clientName: a.client_name,
        clientPhone: phone,
        clientEmail: email,
        allowWhatsApp: allowWA,
      });
      results.push({ id: a.id, client_name: a.client_name, whatsapp: r.whatsapp, email: r.email });
    }

    res.json({ ok: true, date, mode: useTestDestinations ? "test" : "live", notified: results });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error al notificar" }); }
});

/* ── POST /api/barber/appointments ── crear cita manual (con soporte recurrente) ── */
barberRouter.post("/appointments", async (req: Request, res: Response) => {
  const { serviceId, date, time, clientName, clientPhone, clientEmail, recurring } = req.body;
  if (!serviceId || !date || !time || !clientName || !clientPhone) {
    res.status(400).json({ error: "Faltan campos obligatorios" }); return;
  }
  const conn = await db.connect();
  try {
    await conn.query("BEGIN");

    const svc = await conn.query("SELECT * FROM services WHERE id = $1 AND active = true", [serviceId]);
    if (svc.rows.length === 0) { await conn.query("ROLLBACK"); res.status(404).json({ error: "Servicio no encontrado" }); return; }
    const serviceDuration = Number(svc.rows[0].duration);

    // upsert cliente por teléfono
    const upsert = await conn.query(
      `INSERT INTO clients (name, phone, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (phone) DO UPDATE
         SET name = EXCLUDED.name,
             email = COALESCE(EXCLUDED.email, clients.email)
       RETURNING id, email, opt_in_whatsapp`,
      [clientName.trim(), clientPhone.trim(), clientEmail?.trim() || null]
    );
    const clientId = upsert.rows[0].id;
    const duration = await resolveEffectiveDuration(conn, clientId, serviceDuration);

    const start = new Date(`${date}T${time}:00`);
    const end = new Date(start.getTime() + duration * 60000);
    const startLocal = fmtLocal(start);
    const endLocal = fmtLocal(end);

    const overlap = await conn.query(
      `SELECT id FROM appointments
       WHERE status != 'cancelled'
         AND start_time < $2 AND end_time > $1
       FOR UPDATE`,
      [startLocal, endLocal]
    );
    if (overlap.rows.length > 0) { await conn.query("ROLLBACK"); res.status(409).json({ error: "Horario ocupado" }); return; }

    const groupId = recurring ? crypto.randomUUID() : null;
    const recurrence = recurring ? "weekly" : null;

    const appt = await conn.query(
      `INSERT INTO appointments (client_id, service_id, start_time, end_time, recurrence, recurrence_group_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, token, status, start_time, end_time`,
      [clientId, serviceId, startLocal, endLocal, recurrence, groupId]
    );

    // Generar citas recurrentes (52 semanas)
    let recurringCount = 0;
    if (recurring && groupId) {
      const cfg = await getSettings();
      for (let w = 1; w <= 52; w++) {
        const rStart = new Date(start.getTime() + w * 7 * 86400000);
        const rEnd = new Date(rStart.getTime() + duration * 60000);
        const isoDay = rStart.getDay() === 0 ? 7 : rStart.getDay();
        if (!cfg.workDays.includes(isoDay)) continue;
        const rStartLocal = fmtLocal(rStart);
        const rEndLocal = fmtLocal(rEnd);
        const conflict = await conn.query(
          `SELECT id FROM appointments WHERE status != 'cancelled' AND start_time < $2 AND end_time > $1`,
          [rStartLocal, rEndLocal]
        );
        if (conflict.rows.length === 0) {
          await conn.query(
            `INSERT INTO appointments (client_id, service_id, start_time, end_time, recurrence, recurrence_group_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [clientId, serviceId, rStartLocal, rEndLocal, recurrence, groupId]
          );
          recurringCount++;
        }
      }
    }

    await conn.query("COMMIT");

    void notifyAppointmentCreated({
      kind: "created",
      serviceName: svc.rows[0].name,
      startTimeIso: appt.rows[0].start_time,
      endTimeIso: appt.rows[0].end_time,
      token: appt.rows[0].token,
      clientName: clientName.trim(),
      clientPhone: clientPhone.trim(),
      clientEmail: upsert.rows[0].email || null,
      allowWhatsApp: Boolean(upsert.rows[0].opt_in_whatsapp),
    });

    res.status(201).json({ ...appt.rows[0], recurringCount });
  } catch (e) { await conn.query("ROLLBACK").catch(() => {}); console.error(e); res.status(500).json({ error: "Error al crear cita" }); }
  finally { conn.release(); }
});

/* ── PATCH /api/barber/appointments/:id/reschedule ── drag & drop ── */
barberRouter.patch("/appointments/:id/reschedule", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { date, time } = req.body as { date: string; time: string };
  if (!Number.isInteger(id) || !date || !time) {
    res.status(400).json({ error: "Faltan campos" }); return;
  }
  const conn = await db.connect();
  try {
    await conn.query("BEGIN");
    const existing = await conn.query(
      `SELECT a.*, s.duration, s.name AS service_name,
              c.name AS client_name, c.phone, c.email, c.opt_in_whatsapp
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN clients c ON c.id = a.client_id
       WHERE a.id = $1 FOR UPDATE`,
      [id]
    );
    if (existing.rows.length === 0) { await conn.query("ROLLBACK"); res.status(404).json({ error: "Cita no encontrada" }); return; }
    const row = existing.rows[0];
    if (row.status === "cancelled" || row.status === "completed") {
      await conn.query("ROLLBACK"); res.status(400).json({ error: "No se puede mover una cita " + row.status }); return;
    }

    const newStart = new Date(`${date}T${time}:00`);
    const newEnd = new Date(newStart.getTime() + row.duration * 60000);
    const newStartLocal = fmtLocal(newStart);
    const newEndLocal = fmtLocal(newEnd);

    const overlap = await conn.query(
      `SELECT id FROM appointments WHERE status != 'cancelled' AND id != $3 AND start_time < $2 AND end_time > $1`,
      [newStartLocal, newEndLocal, id]
    );
    if (overlap.rows.length > 0) { await conn.query("ROLLBACK"); res.status(409).json({ error: "Horario ocupado" }); return; }

    await conn.query(
      `UPDATE appointments SET start_time = $1, end_time = $2 WHERE id = $3`,
      [newStartLocal, newEndLocal, id]
    );
    await conn.query("COMMIT");

    void notifyAppointmentCreated({
      kind: "updated",
      serviceName: row.service_name,
      startTimeIso: newStartLocal,
      endTimeIso: newEndLocal,
      token: row.token,
      clientName: row.client_name,
      clientPhone: row.phone,
      clientEmail: row.email || null,
      allowWhatsApp: Boolean(row.opt_in_whatsapp),
    });

    res.json({ ok: true, start_time: newStartLocal, end_time: newEndLocal });
  } catch (e) { await conn.query("ROLLBACK").catch(() => {}); console.error(e); res.status(500).json({ error: "Error al reprogramar" }); }
  finally { conn.release(); }
});
