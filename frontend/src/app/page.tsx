"use client";

import { useState, useEffect } from "react";
import { fetchAPI } from "@/lib/api";

interface Service {
  id: number;
  name: string;
  duration: number;
  price: string;
  description?: string;
}

const SERVICE_COPY: Record<string, { title: string; line1: string; line2: string; description: string; icon: string; accent: string }> = {
  "Arreglo de barba": {
    title: "Arreglo de Barba",
    line1: "ARREGLO",
    line2: "DE BARBA",
    description: "Perfilado a medida con navaja, limpieza de contornos y acabado preciso.",
    icon: "bi-scissors",
    accent: "#C9A45C",
  },
  "Corte de pelo": {
    title: "Corte de Pelo",
    line1: "CORTE",
    line2: "DE PELO",
    description: "Diagnostico rapido de estilo, corte personalizado y peinado final.",
    icon: "bi-person-fill",
    accent: "#FFFFFF",
  },
  "Corte y barba": {
    title: "Corte + Barba",
    line1: "CORTE",
    line2: "Y BARBA",
    description: "Pack completo para salir impecable: cabello definido y barba equilibrada.",
    icon: "bi-award-fill",
    accent: "#C9A45C",
  },
  "Corte y barba premium": {
    title: "Corte + Barba Premium",
    line1: "PREMIUM",
    line2: "CORTE + BARBA",
    description: "Sesion extendida con toalla caliente, detalle extra y acabado premium.",
    icon: "bi-gem",
    accent: "#FFFFFF",
  },
  "Mant. de corte": {
    title: "Mantenimiento de Corte",
    line1: "MTTO.",
    line2: "DE CORTE",
    description: "Repaso de forma y volumen para mantener el corte siempre perfecto.",
    icon: "bi-arrow-repeat",
    accent: "#C9A45C",
  },
};

function serviceCopy(name: string, apiDescription?: string) {
  const curated = SERVICE_COPY[name];
  const words = name.toUpperCase().split(" ");
  return {
    title: curated?.title ?? name,
    line1: curated?.line1 ?? words[0],
    line2: curated?.line2 ?? words.slice(1).join(" "),
    description: apiDescription || curated?.description || "Servicio profesional de barberia.",
    icon: curated?.icon ?? "bi-circle",
    accent: curated?.accent ?? "#C9A45C",
  };
}


interface Appointment {
  id: number;
  token: string;
  status: string;
  start_time: string;
  end_time: string;
}

const STEP_LABELS = ["Servicio", "Fecha", "Datos"];

const SERVICE_FALLBACK: Service[] = [
  {
    id: 1,
    name: "Arreglo de barba",
    duration: 30,
    price: "11.50",
    description: "Ritual de toallas italianas con afeitado a navaja.",
  },
  {
    id: 2,
    name: "Corte de pelo",
    duration: 30,
    price: "14.00",
    description: "Asesoramiento, corte y peinado adaptado a tu estilo.",
  },
  {
    id: 3,
    name: "Corte y barba",
    duration: 30,
    price: "20.00",
    description: "Corte completo con arreglo de barba en una sola sesión.",
  },
  {
    id: 4,
    name: "Corte y barba premium",
    duration: 60,
    price: "22.00",
    description: "Ritual premium con acabado de toallas calientes.",
  },
  {
    id: 5,
    name: "Mant. de corte",
    duration: 30,
    price: "11.50",
    description: "Mantenimiento para clientes de los ultimos 15 dias.",
  },
];

/* ── helpers ── */
const weekdayLabels = ["L", "M", "X", "J", "V", "S", "D"];

function toDayStart(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, amount: number) {
  const next = new Date(d);
  next.setDate(next.getDate() + amount);
  return next;
}

function buildCalendarMonthGrid(monthRef: Date) {
  const monthStart = new Date(monthRef.getFullYear(), monthRef.getMonth(), 1);
  const weekOffset = (monthStart.getDay() + 6) % 7; // monday first
  const firstCell = addDays(monthStart, -weekOffset);
  return Array.from({ length: 42 }, (_, i) => addDays(firstCell, i));
}

function shiftsToHours(shifts: { start: number; end: number }[]): string[] {
  const out: string[] = [];
  for (const s of shifts) {
    for (let h = s.start; h < s.end; h++) {
      out.push(`${String(h).padStart(2, "0")}:00`);
      if (h + 0.5 < s.end) out.push(`${String(h).padStart(2, "0")}:30`);
    }
  }
  return out;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const fmtFull = new Intl.DateTimeFormat("es-ES", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

export default function BookingPage() {
  const today = toDayStart(new Date());
  const [assetVersion] = useState(() => String(Date.now()));
  const [step, setStep] = useState(0);
  const [services, setServices] = useState<Service[]>(SERVICE_FALLBACK);
  const [svc, setSvc] = useState<Service | null>(null);
  const [infoServiceId, setInfoServiceId] = useState<number | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [slot, setSlot] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", email: "", wa: true });
  const [appt, setAppt] = useState<Appointment | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [workDays, setWorkDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [workShifts, setWorkShifts] = useState<{ start: number; end: number }[]>([]);
  const [closedDates, setClosedDates] = useState<string[]>([]);
  const [closedLoading, setClosedLoading] = useState(true);
  const [nextAvail, setNextAvail] = useState<string | null>(null);
  const [nextAvailLoading, setNextAvailLoading] = useState(false);
  const [quickHour, setQuickHour] = useState<string | null>(null);
  const [quickSearching, setQuickSearching] = useState(false);
  const [quickNotFound, setQuickNotFound] = useState(false);

  const monthGrid = buildCalendarMonthGrid(calendarMonth);
  const visibleGrid = (() => {
    const weeks = Array.from({ length: 6 }, (_, w) => monthGrid.slice(w * 7, w * 7 + 7));
    return weeks
      .filter((week) =>
        week.some((d) => {
          const outOfMonth = d.getMonth() !== calendarMonth.getMonth();
          const isPast = toDayStart(d).getTime() < today.getTime();
          return !outOfMonth && !isPast;
        })
      )
      .flat();
  })();
  const selectedDateObj = date ? new Date(`${date}T12:00:00`) : null;
  const monthTitle = new Intl.DateTimeFormat("es-ES", {
    month: "long",
    year: "numeric",
  }).format(calendarMonth);

  useEffect(() => {
    fetchAPI<Service[]>("/api/services")
      .then((data) => {
        if (!Array.isArray(data) || data.length === 0) {
          setServices(SERVICE_FALLBACK);
          return;
        }

        const merged = data.map((item) => {
          const match = SERVICE_FALLBACK.find((base) => base.name === item.name);
          return {
            ...item,
            description: match?.description,
          };
        });

        setServices(merged);
      })
      .catch(() => {
        setServices(SERVICE_FALLBACK);
      });
  }, []);

  useEffect(() => {
    fetchAPI<{ shifts: { start: number; end: number }[]; workDays: number[] }>("/api/barber/settings")
      .then((cfg) => { setWorkDays(cfg.workDays); setWorkShifts(cfg.shifts || []); })
      .catch(() => {});
  }, []);

  // Fetch closed dates when calendar month changes
  useEffect(() => {
    setClosedLoading(true);
    setClosedDates([]);
    const monthStr = `${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, "0")}`;
    fetchAPI<string[]>(`/api/slots/closed-dates?month=${monthStr}`)
      .then(d => { setClosedDates(d); setClosedLoading(false); })
      .catch(() => setClosedLoading(false));
  }, [calendarMonth]);

  useEffect(() => {
    if (!date || !svc) return;
    setSlotsLoading(true);
    setSlot("");
    fetchAPI<string[]>(`/api/slots?date=${date}&serviceId=${svc.id}`)
      .then(setSlots)
      .catch(console.error)
      .finally(() => setSlotsLoading(false));
  }, [date, svc]);

  useEffect(() => {
    if (!date || !svc || slotsLoading || slots.length > 0) { setNextAvail(null); return; }
    let cancelled = false;
    setNextAvailLoading(true);
    setNextAvail(null);
    (async () => {
      for (let i = 1; i <= 21; i++) {
        if (cancelled) return;
        const d = addDays(new Date(`${date}T12:00:00`), i);
        const key = iso(d);
        const dayNum = d.getDay() === 0 ? 7 : d.getDay();
        if (!workDays.includes(dayNum)) continue;
        try {
          const result = await fetchAPI<string[]>(`/api/slots?date=${key}&serviceId=${svc.id}`);
          if (!cancelled && result.length > 0) { setNextAvail(key); break; }
        } catch {}
      }
      if (!cancelled) setNextAvailLoading(false);
    })();
    return () => { cancelled = true; };
  }, [slots, slotsLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchByHour = async (hour: string) => {
    if (!svc) return;
    setQuickHour(hour);
    setQuickSearching(true);
    setQuickNotFound(false);
    for (let i = 0; i <= 30; i++) {
      const d = addDays(today, i);
      const key = iso(d);
      const dayNum = d.getDay() === 0 ? 7 : d.getDay();
      if (!workDays.includes(dayNum)) continue;
      try {
        const result = await fetchAPI<string[]>(`/api/slots?date=${key}&serviceId=${svc.id}`);
        if (result.includes(hour)) {
          setCalendarMonth(new Date(d.getFullYear(), d.getMonth(), 1));
          setDate(key);
          setSlot(hour);
          setQuickSearching(false);
          return;
        }
      } catch { /* continue */ }
    }
    setQuickNotFound(true);
    setQuickSearching(false);
  };

  const next = () => setStep((s) => s + 1);
  const back = () => { setErr(""); setStep((s) => s - 1); };

  const canNext = () => {
    if (step === 0) return !!svc;
    if (step === 1) return !!date && !!slot;
    if (step === 2) return form.name.trim().length > 0 && form.phone.trim().length > 5;
    return true;
  };

  const book = async () => {
    setBusy(true);
    setErr("");
    try {
      const result = await fetchAPI<Appointment>("/api/appointments", {
        method: "POST",
        body: JSON.stringify({
          serviceId: svc!.id,
          date,
          time: slot,
          name: form.name.trim(),
          phone: form.phone.trim(),
          email: form.email.trim() || undefined,
          optInWhatsapp: form.wa,
        }),
      });
      setAppt(result);
      setStep(3);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Error al reservar");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep(0);
    setSvc(null);
    setDate("");
    setSlot("");
    setForm({ name: "", phone: "", email: "", wa: true });
    setAppt(null);
    setErr("");
  };

  return (
    <main>
      {/* ── Header ── */}
      <header className="bc-header">
        <div className="bc-container bc-header-inner">
          <span className="bc-brand">M<span className="bc-brand-dot">O</span>G</span>
          {step < 3 && (
            <nav className="bc-steps" aria-label="Pasos del proceso">
              {STEP_LABELS.map((l, i) => (
                <span
                  key={l}
                  className={`bc-step${i < step ? " done" : ""}${i === step ? " active" : ""}`}
                >
                  <span className="bc-step-num">{i + 1}.</span>
                  {l}
                </span>
              ))}
            </nav>
          )}
        </div>
      </header>

      {err && (
        <div className="bc-container">
          <div className="bc-inline-error">{err}</div>
        </div>
      )}

      {/* ── Step 0: Servicios ── */}
      {step === 0 && (
        <section className="bc-section">
          <div className="bc-container">
            <div className="bc-section-header">
              <span className="bc-ghost" aria-hidden="true">Services</span>
              <h2>Elige tu servicio</h2>
            </div>
            <div className="bc-divider" />
            <ul className="bc-svc-list">
              {services.map((s) => {
                const copy = serviceCopy(s.name, s.description);
                return (
                  <li
                    key={s.id}
                    className={`bc-svc-item${svc?.id === s.id ? " sel" : ""}`}
                    onClick={() => { if (svc?.id === s.id) { next(); } else { setSvc(s); } }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        if (svc?.id === s.id) { next(); } else { setSvc(s); }
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-pressed={svc?.id === s.id}
                  >
                    <div className="bc-svc-wrap">
                      <span className="bc-svc-icon">
                        <i className={`bi ${copy.icon}`} aria-hidden="true" />
                      </span>
                      <div className="bc-svc-body">
                        <h3 className="bc-svc-name">{s.name}</h3>
                        <p className="bc-svc-desc">{copy.description}</p>
                        <div className="bc-svc-meta">
                          <span className="bc-svc-price">{Number(s.price).toFixed(2)} €</span>
                          <span className="bc-svc-dur">{s.duration} min</span>
                        </div>
                      </div>
                      <span className="bc-svc-tick" aria-hidden="true">✓</span>
                    </div>
                  </li>
                );
              })}
            </ul>
            <button className="bc-btn" disabled={!canNext()} onClick={next} type="button">
              Siguiente →
            </button>
          </div>
        </section>
      )}

      {/* ── Step 1: Fecha + hora ── */}
      {step === 1 && (
        <section className="bc-section">
          <div className="bc-container">
            <div className="bc-section-header">
              <span className="bc-ghost" aria-hidden="true">Calendar</span>
              <h2>Elige día y hora</h2>
            </div>
            <div className="bc-divider" />

            {workShifts.length > 0 && (
              <div className="bc-quick-hours">
                <p className="bc-quick-label">Próximo hueco a las →</p>
                <div className="bc-quick-grid">
                  {shiftsToHours(workShifts).map((h) => (
                    <button
                      key={h}
                      type="button"
                      className={`bc-quick-btn${quickHour === h ? " active" : ""}${quickSearching && quickHour === h ? " searching" : ""}`}
                      onClick={() => searchByHour(h)}
                      disabled={quickSearching}
                    >
                      {h}
                    </button>
                  ))}
                </div>
                {quickSearching && <p className="bc-slots-loading">Buscando…</p>}
                {quickNotFound && !quickSearching && (
                  <p className="bc-no-slots-msg">Sin disponibilidad en los próximos 30 días a esa hora.</p>
                )}
              </div>
            )}

            <div className="bc-cal" aria-label="Calendario mensual">
              <div className="bc-cal-head">
                <button
                  className="bc-cal-nav-btn"
                  type="button"
                  aria-label="Mes anterior"
                  disabled={
                    calendarMonth.getFullYear() === today.getFullYear() &&
                    calendarMonth.getMonth() === today.getMonth()
                  }
                  onClick={() =>
                    setCalendarMonth(
                      new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1)
                    )
                  }
                >
                  ‹
                </button>
                <span className="bc-cal-title">{monthTitle}</span>
                <button
                  className="bc-cal-nav-btn"
                  type="button"
                  aria-label="Mes siguiente"
                  onClick={() =>
                    setCalendarMonth(
                      new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1)
                    )
                  }
                >
                  ›
                </button>
              </div>

              <div className="bc-cal-weekdays">
                {weekdayLabels.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>

              <div className="bc-cal-grid">
                {visibleGrid.map((d) => {
                  const key = iso(d);
                  const outOfMonth = d.getMonth() !== calendarMonth.getMonth();
                  const isoDay = d.getDay() === 0 ? 7 : d.getDay();
                  const closedDay = !workDays.includes(isoDay);
                  const manuallyClosed = !closedLoading && closedDates.includes(key);
                  const isPast = toDayStart(d).getTime() < today.getTime();
                  const hiddenDay = outOfMonth || isPast;
                  const disabled =
                    hiddenDay ||
                    closedDay ||
                    manuallyClosed ||
                    (closedLoading && !outOfMonth && !closedDay && !isPast);
                  const selected = selectedDateObj ? isSameDay(d, selectedDateObj) : false;
                  const todayCell = isSameDay(d, today);
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`bc-cal-cell${hiddenDay ? " ghost" : ""}${selected ? " selected" : ""}${todayCell ? " today" : ""}`}
                      onClick={() => { if (!disabled) setDate(key); }}
                      disabled={disabled}
                      aria-label={d.toLocaleDateString("es-ES")}
                    >
                      {hiddenDay ? "" : d.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>

            {date && (
              <div className="bc-slots">
                {slotsLoading ? (
                  <p className="bc-slots-loading">Cargando huecos…</p>
                ) : slots.length === 0 ? (
                  <div>
                    <p className="bc-no-slots-msg">No hay huecos disponibles para este día.</p>
                    {nextAvailLoading && (
                      <p className="bc-slots-loading">Buscando próximo hueco…</p>
                    )}
                    {nextAvail && !nextAvailLoading && (
                      <button
                        className="bc-next-avail"
                        type="button"
                        onClick={() => {
                          const nd = new Date(`${nextAvail}T12:00:00`);
                          setCalendarMonth(new Date(nd.getFullYear(), nd.getMonth(), 1));
                          setDate(nextAvail);
                        }}
                      >
                        Próximo hueco: {fmtFull.format(new Date(`${nextAvail}T12:00:00`))} →
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    {[
                      { label: "Mañana", slots: slots.filter((s) => parseInt(s) < 14) },
                      { label: "Tarde",  slots: slots.filter((s) => parseInt(s) >= 14) },
                    ]
                      .filter((g) => g.slots.length > 0)
                      .map((g) => (
                        <div key={g.label}>
                          <p className="bc-slots-group-label">{g.label}</p>
                          <div className="bc-slot-grid">
                            {g.slots.map((s) => (
                              <button
                                key={s}
                                type="button"
                                className={`bc-slot-btn${slot === s ? " active" : ""}`}
                                onClick={() => setSlot(s)}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                  </>
                )}
              </div>
            )}

            <div className="bc-btn-row">
              <button className="bc-btn bc-btn--ghost" onClick={back} type="button">
                ← Atrás
              </button>
              <button className="bc-btn" disabled={!canNext()} onClick={next} type="button">
                Siguiente →
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Step 2: Datos ── */}
      {step === 2 && (
        <section className="bc-section">
          <div className="bc-container">
            <div className="bc-section-header">
              <span className="bc-ghost" aria-hidden="true">Booking</span>
              <h2>Tus datos</h2>
            </div>
            <div className="bc-divider" />

            {svc && date && slot && (
              <div className="bc-summary">
                <div className="bc-summary-row">
                  <span className="bc-summary-key">Servicio</span>
                  <span className="bc-summary-val">{svc.name}</span>
                </div>
                <div className="bc-summary-row">
                  <span className="bc-summary-key">Fecha</span>
                  <span className="bc-summary-val">{fmtFull.format(new Date(date + "T12:00:00"))}</span>
                </div>
                <div className="bc-summary-row">
                  <span className="bc-summary-key">Hora</span>
                  <span className="bc-summary-val">{slot}h · {svc.duration} min</span>
                </div>
                <div className="bc-summary-row">
                  <span className="bc-summary-key">Precio</span>
                  <span className="bc-summary-val gold">{parseFloat(svc.price).toFixed(2)} €</span>
                </div>
              </div>
            )}

            <div className="bc-form">
              <div className="bc-field-group">
                <label className="bc-field-label">Nombre *</label>
                <input
                  className="bc-field"
                  placeholder="Tu nombre"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="bc-field-group">
                <label className="bc-field-label">Teléfono *</label>
                <input
                  className="bc-field"
                  type="tel"
                  placeholder="612 345 678"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="bc-field-group">
                <label className="bc-field-label">
                  Email{" "}
                  <span style={{ textTransform: "none", fontSize: "11px", opacity: 0.6 }}>
                    (opcional)
                  </span>
                </label>
                <input
                  className="bc-field"
                  type="email"
                  placeholder="tu@email.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <label className="bc-wa-row">
                <input
                  type="checkbox"
                  checked={form.wa}
                  onChange={(e) => setForm({ ...form, wa: e.target.checked })}
                />
                <span>Acepto recibir recordatorios por WhatsApp</span>
              </label>
            </div>

            <div className="bc-btn-row">
              <button className="bc-btn bc-btn--ghost" onClick={back} type="button">
                ← Atrás
              </button>
              <button
                className="bc-btn"
                disabled={!canNext() || busy}
                onClick={book}
                type="button"
              >
                {busy ? "Reservando…" : "Confirmar reserva"}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Step 3: Éxito ── */}
      {step === 3 && appt && (
        <div className="bc-container">
          <div className="bc-success">
            <div className="bc-success-icon">✓</div>
            <h2>¡Reserva confirmada!</h2>
            <p>Te esperamos en MOG. Aquí tienes el resumen de tu cita.</p>
            <div className="bc-summary">
              <div className="bc-summary-row">
                <span className="bc-summary-key">Servicio</span>
                <span className="bc-summary-val">{svc?.name}</span>
              </div>
              <div className="bc-summary-row">
                <span className="bc-summary-key">Fecha</span>
                <span className="bc-summary-val">{fmtFull.format(new Date(date + "T12:00:00"))}</span>
              </div>
              <div className="bc-summary-row">
                <span className="bc-summary-key">Hora</span>
                <span className="bc-summary-val">{slot}h · {svc?.duration} min</span>
              </div>
              <div className="bc-summary-row">
                <span className="bc-summary-key">Precio</span>
                <span className="bc-summary-val gold">
                  {svc ? parseFloat(svc.price).toFixed(2) + " €" : ""}
                </span>
              </div>
            </div>
            <a className="bc-manage-link" href={`/manage?token=${appt.token}`}>
              Ver / cancelar mi cita →
            </a>
            <br />
            <br />
            <button className="bc-btn bc-btn--ghost" onClick={reset} type="button">
              Reservar otra cita
            </button>
          </div>
        </div>
      )}
    </main>
  );
}