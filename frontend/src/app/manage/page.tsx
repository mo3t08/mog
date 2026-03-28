"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fetchAPI } from "@/lib/api";

interface ManagedAppointment {
  id: number;
  token: string;
  status: "pending" | "cancelled" | "completed" | "no_show";
  start_time: string;
  end_time: string;
  service_name: string;
  duration: number;
  price: string;
  client_name: string;
  phone: string;
}

const fmtDate = new Intl.DateTimeFormat("es-ES", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const fmtTime = new Intl.DateTimeFormat("es-ES", {
  hour: "2-digit",
  minute: "2-digit",
});

function extractApiError(err: unknown, fallback: string) {
  const msg = err instanceof Error ? err.message : "";
  const raw = msg.replace(/^API error \d+:\s*/, "").trim();
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    if (parsed?.error) return parsed.error;
  } catch {
    // keep fallback
  }
  return fallback;
}

function statusLabel(status: ManagedAppointment["status"]) {
  if (status === "pending") return "Pendiente";
  if (status === "completed") return "Completada";
  if (status === "no_show") return "No asistió";
  return "Cancelada";
}

export default function ManagePage() {
  const params = useSearchParams();
  const token = useMemo(() => params.get("token")?.trim() ?? "", [params]);

  const [appt, setAppt] = useState<ManagedAppointment | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError("Falta el token de la cita. Usa el enlace completo recibido.");
      return;
    }

    setLoading(true);
    setError("");

    fetchAPI<ManagedAppointment>(`/api/appointments/${token}`)
      .then((data) => setAppt(data))
      .catch((err) => {
        setError(extractApiError(err, "No hemos podido cargar la cita."));
        setAppt(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const cancelAppointment = async () => {
    if (!appt || appt.status === "cancelled") return;
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      await fetchAPI<{ ok: boolean }>(`/api/appointments/${appt.token}`, {
        method: "DELETE",
      });
      setAppt({ ...appt, status: "cancelled" });
      setSuccess("Tu cita se ha cancelado correctamente.");
    } catch (err) {
      setError(extractApiError(err, "No se pudo cancelar la cita."));
    } finally {
      setBusy(false);
    }
  };

  const canCancel = Boolean(appt && appt.status === "pending");

  return (
    <main>
      <header className="bc-header">
        <div className="bc-container bc-header-inner">
          <Link href="/" className="bc-brand" aria-label="Ir a inicio">
            MOG<span className="bc-brand-dot">.</span>
          </Link>
          <div className="bc-steps" aria-hidden="true">
            <span className="bc-step active">
              <span className="bc-step-num">01</span> Gestionar cita
            </span>
          </div>
        </div>
      </header>

      <section className="bc-section">
        <div className="bc-container">
          <div className="bc-section-header bc-manage-head">
            <span className="bc-ghost" aria-hidden="true">Manage</span>
            <h2>Gestiona tu cita</h2>
          </div>
          <div className="bc-divider" />

          {loading && <p className="bc-slots-loading">Cargando tu cita…</p>}

          {!loading && error && <div className="bc-inline-error">{error}</div>}

          {!loading && success && <div className="bc-inline-ok">{success}</div>}

          {!loading && appt && (
            <>
              <div className="bc-summary bc-manage-summary">
                <div className="bc-summary-row">
                  <span className="bc-summary-key">Estado</span>
                  <span className={`bc-status-pill ${appt.status}`}>{statusLabel(appt.status)}</span>
                </div>
                <div className="bc-summary-row">
                  <span className="bc-summary-key">Cliente</span>
                  <span className="bc-summary-val">{appt.client_name}</span>
                </div>
                <div className="bc-summary-row">
                  <span className="bc-summary-key">Teléfono</span>
                  <span className="bc-summary-val">{appt.phone}</span>
                </div>
                <div className="bc-summary-row">
                  <span className="bc-summary-key">Servicio</span>
                  <span className="bc-summary-val">{appt.service_name}</span>
                </div>
                <div className="bc-summary-row">
                  <span className="bc-summary-key">Fecha</span>
                  <span className="bc-summary-val">{fmtDate.format(new Date(appt.start_time))}</span>
                </div>
                <div className="bc-summary-row">
                  <span className="bc-summary-key">Hora</span>
                  <span className="bc-summary-val">
                    {fmtTime.format(new Date(appt.start_time))} - {fmtTime.format(new Date(appt.end_time))}
                  </span>
                </div>
                <div className="bc-summary-row">
                  <span className="bc-summary-key">Precio</span>
                  <span className="bc-summary-val gold">{Number(appt.price).toFixed(2)} €</span>
                </div>
              </div>

              <div className="bc-manage-actions">
                <Link href="/" className="bc-btn bc-btn--ghost">
                  Volver a reservar
                </Link>
                <button
                  type="button"
                  className="bc-btn bc-btn-danger"
                  onClick={cancelAppointment}
                  disabled={!canCancel || busy}
                >
                  {busy ? "Cancelando…" : canCancel ? "Cancelar cita" : "No cancelable"}
                </button>
              </div>

              {!canCancel && appt.status !== "cancelled" && (
                <p className="bc-help-note">
                  Esta cita no se puede cancelar desde aquí porque ya no está en estado pendiente.
                </p>
              )}

              {appt.status === "cancelled" && (
                <p className="bc-help-note">
                  Tu cita ya está cancelada. Si quieres, puedes crear una nueva reserva.
                </p>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
