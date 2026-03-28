import { Router, Request, Response } from "express";
import type { PoolClient } from "pg";
import db from "../db.js";
import { notifyAppointmentCreated } from "../lib/notifications.js";

export const appointmentsRouter = Router();

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

async function cancelByToken(token: string) {
  const { rows } = await db.query(
    "SELECT id, start_time, status FROM appointments WHERE token = $1",
    [token]
  );
  if (rows.length === 0) return { ok: false, code: 404 as const, message: "Cita no encontrada" };

  const appt = rows[0];
  if (appt.status === "cancelled") return { ok: false, code: 400 as const, message: "La cita ya está cancelada" };

  const hoursUntil = (new Date(appt.start_time).getTime() - Date.now()) / 3_600_000;
  if (hoursUntil < 3) {
    return { ok: false, code: 400 as const, message: "No se puede cancelar con menos de 3 h de antelación" };
  }

  await db.query("UPDATE appointments SET status = 'cancelled' WHERE id = $1", [appt.id]);
  return { ok: true as const };
}

/* ── POST /api/appointments ── crear cita ── */
appointmentsRouter.post("/", async (req: Request, res: Response) => {
  const { serviceId, date, time, name, phone, email, optInWhatsapp } = req.body;

  if (!serviceId || !date || !time || !name || !phone) {
    res.status(400).json({ error: "Faltan campos obligatorios" });
    return;
  }

  const conn = await db.connect();
  try {
    await conn.query("BEGIN");

    const svc = await conn.query("SELECT id, name, duration FROM services WHERE id = $1", [serviceId]);
    if (svc.rows.length === 0) {
      await conn.query("ROLLBACK");
      res.status(404).json({ error: "Servicio no encontrado" });
      return;
    }
    const serviceDuration = Number(svc.rows[0].duration);

    /* upsert cliente por teléfono */
    const cl = await conn.query(
      `INSERT INTO clients (name, phone, email, opt_in_whatsapp)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (phone) DO UPDATE
         SET name = $1,
             email = COALESCE($3, clients.email),
             opt_in_whatsapp = $4
       RETURNING id`,
      [name, phone, email || null, optInWhatsapp || false]
    );

    const effectiveDuration = await resolveEffectiveDuration(conn, cl.rows[0].id, serviceDuration);

    const startTime = new Date(`${date}T${time}:00`);
    const endTime = new Date(startTime.getTime() + effectiveDuration * 60_000);
    /* Formatear como hora local (las columnas son timestamp without time zone, almacenan hora Madrid) */
    const pad = (n: number) => n.toString().padStart(2, "0");
    const fmtLocal = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const startLocal = fmtLocal(startTime);
    const endLocal = fmtLocal(endTime);

    /* bloqueo optimista con FOR UPDATE */
    const { rows: conflicts } = await conn.query(
      `SELECT id FROM appointments
       WHERE status != 'cancelled'
         AND start_time < $2 AND end_time > $1
       FOR UPDATE`,
      [startLocal, endLocal]
    );

    if (conflicts.length > 0) {
      await conn.query("ROLLBACK");
      res.status(409).json({ error: "Ese hueco ya no está disponible" });
      return;
    }

    const appt = await conn.query(
      `INSERT INTO appointments (client_id, service_id, start_time, end_time)
       VALUES ($1, $2, $3, $4)
       RETURNING id, token, status, start_time, end_time`,
      [cl.rows[0].id, serviceId, startLocal, endLocal]
    );

    await conn.query("COMMIT");

    void notifyAppointmentCreated({
      kind: "created",
      serviceName: svc.rows[0].name,
      startTimeIso: appt.rows[0].start_time,
      endTimeIso: appt.rows[0].end_time,
      token: appt.rows[0].token,
      clientName: name,
      clientPhone: phone,
      clientEmail: email || null,
      allowWhatsApp: Boolean(optInWhatsapp),
    });

    res.status(201).json(appt.rows[0]);
  } catch (err) {
    await conn.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Error al crear la cita" });
  } finally {
    conn.release();
  }
});

/* ── GET /api/appointments/:token/cancel ── cancelar desde mensaje ── */
appointmentsRouter.get("/:token/cancel", async (req: Request, res: Response) => {
  try {
    const result = await cancelByToken(req.params.token);
    if (!result.ok) {
      res.status(result.code).send(`
        <html><body style="font-family: sans-serif; padding: 24px; background: #111; color: #eee;">
          <h2 style="color:#d9b56a;">No se pudo cancelar</h2>
          <p>${result.message}</p>
        </body></html>
      `);
      return;
    }
    res.send(`
      <html><body style="font-family: sans-serif; padding: 24px; background: #111; color: #eee;">
        <h2 style="color:#d9b56a;">Cita cancelada</h2>
        <p>Tu cita se ha cancelado correctamente.</p>
      </body></html>
    `);
  } catch {
    res.status(500).send("Error al cancelar");
  }
});

/* ── GET /api/appointments/:token ── */
appointmentsRouter.get("/:token", async (req: Request, res: Response) => {
  try {
    const { rows } = await db.query(
      `SELECT a.id, a.token, a.status, a.start_time, a.end_time,
              s.name AS service_name, s.duration, s.price,
              c.name AS client_name, c.phone
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN clients  c ON c.id = a.client_id
       WHERE a.token = $1`,
      [req.params.token]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "Cita no encontrada" });
      return;
    }
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Error al obtener la cita" });
  }
});

/* ── DELETE /api/appointments/:token ── cancelar ── */
appointmentsRouter.delete("/:token", async (req: Request, res: Response) => {
  try {
    const result = await cancelByToken(req.params.token);
    if (!result.ok) {
      res.status(result.code).json({ error: result.message });
      return;
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error al cancelar" });
  }
});
