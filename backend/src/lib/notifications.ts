import nodemailer from "nodemailer";
import twilio from "twilio";

export type NotificationKind = "created" | "updated" | "cancelled" | "confirmed" | "reminder";

export interface AppointmentNotificationInput {
  kind: NotificationKind;
  serviceName: string;
  startTimeIso: string;
  endTimeIso: string;
  token: string;
  clientName: string;
  clientPhone: string;
  clientEmail?: string | null;
  allowWhatsApp?: boolean;
}

type SendStatus = "sent" | "skipped" | "failed";

export interface NotificationResult {
  email: SendStatus;
  whatsapp: SendStatus;
  errors: string[];
}

const EMAIL_ENABLED = (process.env.NOTIFY_EMAIL_ENABLED ?? "true") === "true";
const WHATSAPP_ENABLED = (process.env.NOTIFY_WHATSAPP_ENABLED ?? "true") === "true";

const SMTP_HOST = process.env.SMTP_HOST || "smtp-relay.brevo.com";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const FROM_EMAIL = process.env.NOTIFY_FROM_EMAIL || "no-reply@mog.local";
const FROM_NAME = process.env.NOTIFY_FROM_NAME || "MOG Barber";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "http://localhost:4000";
const PUBLIC_FRONTEND_URL =
  process.env.PUBLIC_FRONTEND_URL ||
  process.env.PUBLIC_BOOKING_URL ||
  PUBLIC_BASE_URL.replace(":4000", ":3010");
const TEST_NOTIFY_EMAIL = process.env.TEST_NOTIFY_EMAIL || "";
const TEST_NOTIFY_PHONE = process.env.TEST_NOTIFY_PHONE || "";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";
const MSG_STYLE = (process.env.MSG_STYLE || "rich").toLowerCase(); // "rich" (emojis) | "clean" (formal)

const transporter = EMAIL_ENABLED && SMTP_USER && SMTP_PASS
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
  : null;

const twilioClient = WHATSAPP_ENABLED && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
  ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  : null;

function fmtDateTimeRange(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const dateLong = start.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  /* Capitalizar primera letra: "jueves, 26 de marzo" → "Jueves, 26 de marzo" */
  const date = dateLong.charAt(0).toUpperCase() + dateLong.slice(1);
  const startTime = start.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const endTime = end.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  return { date, startTime, endTime };
}

function normalizePhone(raw: string) {
  const clean = raw.replace(/[^\d+]/g, "").trim();
  if (!clean) return "";
  if (clean.startsWith("whatsapp:")) return clean;
  if (clean.startsWith("+")) return clean;
  if (clean.startsWith("00")) return `+${clean.slice(2)}`;
  if (/^\d{9}$/.test(clean)) return `+34${clean}`;
  if (/^\d{10,15}$/.test(clean)) return `+${clean}`;
  return clean;
}

function normalizeBaseUrl(url: string) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function notificationMeta(kind: NotificationKind) {
  if (kind === "created") return { title: "Reserva confirmada", lead: "tu cita ya está confirmada.", subjectPrefix: "Reserva confirmada" };
  if (kind === "confirmed") return { title: "Cita confirmada", lead: "tu cita ha sido marcada como confirmada.", subjectPrefix: "Cita confirmada" };
  if (kind === "cancelled") return { title: "Cita cancelada", lead: "tu cita ha sido cancelada.", subjectPrefix: "Cita cancelada" };
  if (kind === "reminder") return { title: "Recordatorio de cita", lead: "te recordamos tu próxima cita.", subjectPrefix: "Recordatorio" };
  return { title: "Cita actualizada", lead: "hemos actualizado los datos de tu cita.", subjectPrefix: "Cita actualizada" };
}

function cancelUrl(token: string) {
  return `${normalizeBaseUrl(PUBLIC_BASE_URL)}/api/appointments/${token}/cancel`;
}

function manageUrl(token: string) {
  return `${normalizeBaseUrl(PUBLIC_FRONTEND_URL)}/manage?token=${token}`;
}

function buildEmailHtml(input: AppointmentNotificationInput) {
  const { date, startTime, endTime } = fmtDateTimeRange(input.startTimeIso, input.endTimeIso);
  const meta = notificationMeta(input.kind);
  const canCancel = input.kind !== "cancelled";
  const url = cancelUrl(input.token);

  if (MSG_STYLE === "clean") {
    return `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; background: #ffffff; color: #333; padding: 28px; border: 1px solid #e0ddd6; border-radius: 10px; max-width: 480px;">
      <h2 style="margin: 0 0 14px; color: #222; font-size: 20px;">${meta.title}</h2>
      <p style="margin: 0 0 16px; color: #555;">Hola ${input.clientName}, ${meta.lead}</p>
      <table style="margin: 0 0 18px; border-collapse: collapse; width: 100%;">
        <tr><td style="padding: 6px 14px 6px 0; color: #888; font-size: 14px;">Servicio</td><td style="font-weight: 600; font-size: 14px;">${input.serviceName}</td></tr>
        <tr><td style="padding: 6px 14px 6px 0; color: #888; font-size: 14px;">Fecha</td><td style="font-weight: 600; font-size: 14px;">${date}</td></tr>
        <tr><td style="padding: 6px 14px 6px 0; color: #888; font-size: 14px;">Hora</td><td style="font-weight: 600; font-size: 14px;">${startTime} – ${endTime}</td></tr>
      </table>
      ${canCancel
        ? `<p style="margin: 0 0 8px; color: #666; font-size: 14px;">Si no puedes asistir, puedes cancelar tu cita:</p>
           <a href="${url}" style="display:inline-block;margin: 4px 0 16px; padding:10px 18px; border-radius:8px; text-decoration:none; background:#333; color:#fff; font-weight:600; font-size:14px;">Cancelar cita</a>`
        : ""
      }
      <p style="margin: 0; color: #999; font-size: 12px;">MOG Barber · Si necesitas ayuda, responde a este email.</p>
    </div>`;
  }

  return `
  <div style="font-family: Georgia, serif; background: #0f1014; color: #f5f1e9; padding: 24px; border-radius: 12px;">
    <h2 style="margin: 0 0 12px; color: #d9b56a;">💈 ${meta.title}</h2>
    <p style="margin: 0 0 10px;">Hola ${input.clientName}, ${meta.lead}</p>
    <table style="margin: 0 0 14px; border-collapse: collapse;">
      <tr><td style="padding: 4px 12px 4px 0; color: #bdb6a8;">✂️ Servicio</td><td style="font-weight: 600;">${input.serviceName}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; color: #bdb6a8;">🗓 Fecha</td><td style="font-weight: 600;">${date}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; color: #bdb6a8;">🕒 Hora</td><td style="font-weight: 600;">${startTime} – ${endTime}</td></tr>
    </table>
    ${canCancel
      ? `<p style="margin: 0 0 6px; color: #bdb6a8;">Si no puedes asistir, puedes cancelar tu cita:</p>
         <a href="${url}" style="display:inline-block;margin: 4px 0 14px; padding:10px 14px; border-radius:10px; text-decoration:none; background:#d9b56a; color:#1a1711; font-weight:700;">Cancelar cita</a>`
      : ""
    }
    <p style="margin: 0; color: #bdb6a8; font-size: 13px;">Si necesitas ayuda, responde a este email o contacta por WhatsApp.</p>
  </div>`;
}

function buildWhatsAppClean(input: AppointmentNotificationInput) {
  const { date, startTime, endTime } = fmtDateTimeRange(input.startTimeIso, input.endTimeIso);
  const url = cancelUrl(input.token);
  const manage = manageUrl(input.token);

  if (input.kind === "created") {
    return [
      `MOG Barber — Reserva confirmada`,
      ``,
      `Hola ${input.clientName},`,
      `Tu cita de ${input.serviceName} está confirmada.`,
      ``,
      `Fecha: ${date}`,
      `Hora: ${startTime} – ${endTime}`,
      ``,
      `Para cancelar:`,
      url,
      ``,
      `Gestionar cita:`,
      manage,
      ``,
      `Un saludo, MOG Barber`,
    ].join("\n");
  }

  if (input.kind === "cancelled") {
    return [
      `MOG Barber — Cita cancelada`,
      ``,
      `Hola ${input.clientName},`,
      `Tu cita de ${input.serviceName} ha sido cancelada.`,
      ``,
      `Fecha: ${date}`,
      `Hora: ${startTime} – ${endTime}`,
      ``,
      `Gestionar cita:`,
      manage,
      ``,
      `Puedes reservar de nuevo en cualquier momento.`,
      `Un saludo, MOG Barber`,
    ].join("\n");
  }

  if (input.kind === "reminder") {
    return [
      `MOG Barber — Recordatorio`,
      ``,
      `Hola ${input.clientName},`,
      `Te recordamos tu cita de ${input.serviceName}.`,
      ``,
      `Fecha: ${date}`,
      `Hora: ${startTime} – ${endTime}`,
      ``,
      `Para cancelar:`,
      url,
      ``,
      `Gestionar cita:`,
      manage,
      ``,
      `Un saludo, MOG Barber`,
    ].join("\n");
  }

  return [
    `MOG Barber — Cita actualizada`,
    ``,
    `Hola ${input.clientName},`,
    `Tu cita de ${input.serviceName} ha sido actualizada.`,
    ``,
    `Fecha: ${date}`,
    `Hora: ${startTime} – ${endTime}`,
    ``,
    `Para cancelar:`,
    url,
    ``,
    `Gestionar cita:`,
    manage,
    ``,
    `Un saludo, MOG Barber`,
  ].join("\n");
}

function buildWhatsAppRich(input: AppointmentNotificationInput) {
  const { date, startTime, endTime } = fmtDateTimeRange(input.startTimeIso, input.endTimeIso);
  const url = cancelUrl(input.token);
  const manage = manageUrl(input.token);

  if (input.kind === "created") {
    return [
      `💈 Tu cita está confirmada, *${input.clientName}*`,
      ``,
      `Te esperamos para tu servicio de *${input.serviceName}* ✂️`,
      ``,
      `🗓 *${date}*`,
      `🕒 ${startTime} – ${endTime}`,
      ``,
      `Si no puedes asistir, puedes cancelar tu cita aquí:`,
      `👉 ${url}`,
      ``,
      `Gestiona tu cita aquí:`,
      `🔗 ${manage}`,
      ``,
      `Nos vemos pronto 😉`,
    ].join("\n");
  }

  if (input.kind === "cancelled") {
    return [
      `❌ Cita cancelada, *${input.clientName}*`,
      ``,
      `Tu cita de *${input.serviceName}* ha sido cancelada.`,
      ``,
      `🗓 *${date}*`,
      `🕒 ${startTime} – ${endTime}`,
      ``,
      `Gestiona tu cita aquí:`,
      `🔗 ${manage}`,
      ``,
      `Si quieres reservar de nuevo, ¡te esperamos! 💈`,
    ].join("\n");
  }

  if (input.kind === "reminder") {
    return [
      `⏰ Recordatorio de cita, *${input.clientName}*`,
      ``,
      `Tienes tu cita de *${input.serviceName}* ✂️`,
      ``,
      `🗓 *${date}*`,
      `🕒 ${startTime} – ${endTime}`,
      ``,
      `Si no puedes asistir, cancela aquí:`,
      `👉 ${url}`,
      ``,
      `Gestiona tu cita aquí:`,
      `🔗 ${manage}`,
      ``,
      `¡Te esperamos! 😉`,
    ].join("\n");
  }

  /* confirmed / updated */
  return [
    `💈 Cita actualizada, *${input.clientName}*`,
    ``,
    `Tu cita de *${input.serviceName}* ha sido actualizada ✂️`,
    ``,
    `🗓 *${date}*`,
    `🕒 ${startTime} – ${endTime}`,
    ``,
    `Si no puedes asistir, cancela aquí:`,
    `👉 ${url}`,
    ``,
    `Gestiona tu cita aquí:`,
    `🔗 ${manage}`,
    ``,
    `¡Te esperamos! 😉`,
  ].join("\n");
}

function buildWhatsAppText(input: AppointmentNotificationInput) {
  return MSG_STYLE === "clean"
    ? buildWhatsAppClean(input)
    : buildWhatsAppRich(input);
}

export async function notifyAppointmentCreated(input: AppointmentNotificationInput): Promise<NotificationResult> {
  const result: NotificationResult = { email: "skipped", whatsapp: "skipped", errors: [] };

  if (!transporter && input.clientEmail && EMAIL_ENABLED) {
    result.email = "failed";
    result.errors.push("email: SMTP no configurado (revisar SMTP_USER/SMTP_PASS)");
  }

  if (transporter && input.clientEmail) {
    try {
      await transporter.sendMail({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: input.clientEmail,
        subject: `${notificationMeta(input.kind).subjectPrefix} · ${input.serviceName}`,
        html: buildEmailHtml(input),
      });
      result.email = "sent";
    } catch (error) {
      result.email = "failed";
      result.errors.push(`email: ${error instanceof Error ? error.message : String(error)}`);
      console.error("Email notification error:", error);
    }
  }

  if (!twilioClient && input.allowWhatsApp && WHATSAPP_ENABLED) {
    result.whatsapp = "failed";
    result.errors.push("whatsapp: Twilio no configurado");
  }

  if (twilioClient && input.allowWhatsApp) {
    const toPhone = normalizePhone(TEST_NOTIFY_PHONE || input.clientPhone);
    if (toPhone) {
      try {
        await twilioClient.messages.create({
          from: TWILIO_WHATSAPP_FROM,
          to: `whatsapp:${toPhone}`,
          body: buildWhatsAppText(input),
        });
        result.whatsapp = "sent";
      } catch (error) {
        result.whatsapp = "failed";
        result.errors.push(`whatsapp: ${error instanceof Error ? error.message : String(error)}`);
        console.error("WhatsApp notification error:", error);
      }
    }
  }

  return result;
}

export async function sendTestNotifications(input: {
  email?: string;
  phone?: string;
}) {
  const emailToUse = input.email || TEST_NOTIFY_EMAIL || null;
  const phoneToUse = input.phone || TEST_NOTIFY_PHONE || "";
  const sample: AppointmentNotificationInput = {
    kind: "reminder",
    serviceName: "Corte + Barba",
    startTimeIso: new Date(Date.now() + 3600000).toISOString(),
    endTimeIso: new Date(Date.now() + 5400000).toISOString(),
    token: "TEST-MOG-001",
    clientName: "Cliente Prueba",
    clientPhone: phoneToUse,
    clientEmail: emailToUse,
    allowWhatsApp: Boolean(phoneToUse),
  };
  return notifyAppointmentCreated(sample);
}

export function getDefaultTestDestinations() {
  return {
    email: TEST_NOTIFY_EMAIL || null,
    phone: TEST_NOTIFY_PHONE || "",
  };
}
