"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { fetchAPI } from "@/lib/api";

/* ──────────────────────────── Types ──────────────────────────── */
type Status = "pending" | "completed" | "no_show" | "cancelled";

interface Appt {
  id: number;
  status: Status;
  start_time: string;
  end_time: string;
  token: string;
  service_id: number;
  service_name: string;
  duration: number;
  price: string;
  client_id: number;
  client_name: string;
  phone: string;
  email: string | null;
}

interface Service {
  id: number;
  name: string;
  duration: number;
  price: string;
  active: boolean;
}

interface Client {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  opt_in_whatsapp: boolean;
  observations: string | null;
  preferred_slot_minutes: number | null;
  created_at: string;
  total_appts: string;
  completed_appts: string;
  no_show_appts: string;
  last_appt: string | null;
}

interface Stats {
  totals: {
    total: string;
    pending: string;
    completed: string;
    no_show: string;
    cancelled: string;
    revenue: string;
  };
  byService: { service_name: string; count: string; revenue: string }[];
  byDay: { day: string; count: string; revenue: string }[];
  noShowList: { status: Status; start_time: string; client_name: string; phone: string; service_name: string }[];
  pendingList: { status: Status; start_time: string; client_name: string; phone: string; service_name: string }[];
  cancelledList: { status: Status; start_time: string; client_name: string; phone: string; service_name: string }[];
}

type StatsDetailItem = { status: Status; start_time: string; client_name: string; phone: string; service_name: string };

type Tab = "calendar" | "list" | "stats" | "clients" | "settings";
type CalView = "day" | "week" | "month";

/* ──────────────────────────── Helpers ──────────────────────────── */
const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const todayStr = () => fmtDate(new Date());

function weekStart(d: Date): Date {
  const wd = new Date(d);
  const day = wd.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  wd.setDate(wd.getDate() + diff);
  return wd;
}

function addDays(d: Date, n: number): Date {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n);
  return nd;
}

function monthGrid(pivot: Date): Date[][] {
  const first = new Date(pivot.getFullYear(), pivot.getMonth(), 1);
  const startDay = first.getDay() === 0 ? 6 : first.getDay() - 1;
  const start = new Date(first);
  start.setDate(start.getDate() - startDay);
  const weeks: Date[][] = [];
  const cur = new Date(start);
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let dd = 0; dd < 7; dd++) {
      week.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

const STATUS_LABEL: Record<Status, string> = {
  pending: "Pendiente",
  completed: "Completada",
  no_show: "No presentado",
  cancelled: "Cancelada",
};

const TZ = "Europe/Madrid";

function getHourInMadrid(iso: string): number {
  return parseInt(new Intl.DateTimeFormat("es-ES", { hour: "2-digit", hour12: false, timeZone: TZ }).format(new Date(iso)), 10);
}

function getDateInMadrid(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return parts; // returns YYYY-MM-DD
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

function fmtDateLong(d: Date) {
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ });
}

function fmtDateShort(iso: string) {
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
}

function fmtDateTimeShort(iso: string) {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });
}

const HOUR_H = 72; // px — debe coincidir con .cal-hour-label height en CSS

function getMinuteInMadrid(iso: string): number {
  return parseInt(new Intl.DateTimeFormat("es-ES", { minute: "2-digit", timeZone: TZ }).format(new Date(iso)), 10);
}
function eventTop(iso: string, firstHour: number): number {
  return (getHourInMadrid(iso) - firstHour) * HOUR_H + (getMinuteInMadrid(iso) / 60) * HOUR_H;
}
function eventHeight(duration: number): number {
  return Math.max((duration / 60) * HOUR_H - 2, 20);
}

/* ──────────────────────────── Component ──────────────────────────── */
export default function PanelPage() {
  const [tab, setTab] = useState<Tab>("calendar");
  const [calView, setCalView] = useState<CalView>("day");
  const [pivot, setPivot] = useState<Date>(new Date(todayStr()));

  const [appts, setAppts] = useState<Appt[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(false);

  const [listStatus, setListStatus] = useState("all");
  const [listSearch, setListSearch] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [statsFilter, setStatsFilter] = useState<"all" | Status>("all");
  const [statsAppts, setStatsAppts] = useState<Appt[]>([]);
  const [statsAllAppts, setStatsAllAppts] = useState<Appt[]>([]);
  const statsListRef = useRef<HTMLDivElement>(null);

  const [selectedAppt, setSelectedAppt] = useState<Appt | null>(null);
  const [drawerBusy, setDrawerBusy] = useState(false);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notifyMsg, setNotifyMsg] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [modalForm, setModalForm] = useState({
    serviceId: "", date: todayStr(), time: "10:00",
    clientName: "", clientPhone: "", clientEmail: "",
  });
  const [modalBusy, setModalBusy] = useState(false);
  const [modalErr, setModalErr] = useState("");
  const [modalOk, setModalOk] = useState(false);
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  const [deletingClientId, setDeletingClientId] = useState<number | null>(null);
  const [clientActionErr, setClientActionErr] = useState("");
  const [clientToEdit, setClientToEdit] = useState<Client | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    phone: "",
    email: "",
    observations: "",
    preferredSlotMinutes: "",
  });
  const [savingClient, setSavingClient] = useState(false);
  const [editErr, setEditErr] = useState("");
  const [isLight, setIsLight] = useState(false);

  // Settings state (shifts)
  interface ShiftDef { start: number; end: number }
  interface BizCfg { shifts: ShiftDef[]; workDays: number[] }
  const defaultCfg: BizCfg = { shifts: [{ start: 9, end: 14 }, { start: 16, end: 20 }], workDays: [1, 2, 3, 4, 5] };
  const [bizSettings, setBizSettings] = useState<BizCfg>(defaultCfg);
  const [settingsForm, setSettingsForm] = useState<BizCfg>(defaultCfg);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState("");

  // Closed dates state
  const [closedDates, setClosedDates] = useState<string[]>([]);
  const [apptCounts, setApptCounts] = useState<Record<string, number>>({});
  const [settingsMonth, setSettingsMonth] = useState(() => {
    const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [closeDateBusy, setCloseDateBusy] = useState<string | null>(null);
  const [closeConfirm, setCloseConfirm] = useState<{date: string; count: number} | null>(null);
  const [affectedAppts, setAffectedAppts] = useState<{date: string; appts: {id:number; start_time:string; client_name:string; service_name:string; phone:string}[]} | null>(null);
  const [notifyResult, setNotifyResult] = useState<{date:string; results:{id:number; client_name:string; whatsapp:string}[]} | null>(null);

  // Drag & drop state
  const dragApptRef = useRef<Appt | null>(null);

  // Recurring state in modal
  const [modalRecurring, setModalRecurring] = useState(false);

  // Derived HOURS from settings (union of all shifts)
  const HOURS = (() => {
    const hrs: number[] = [];
    for (const sh of bizSettings.shifts) {
      for (let h = sh.start; h < sh.end; h++) if (!hrs.includes(h)) hrs.push(h);
    }
    return hrs.sort((a, b) => a - b);
  })();

  useEffect(() => {
    const saved = localStorage.getItem("mog-theme");
    if (saved === "light") { setIsLight(true); document.body.classList.add("light"); }
  }, []);

  function toggleTheme() {
    const next = !isLight;
    setIsLight(next);
    document.body.classList.toggle("light", next);
    localStorage.setItem("mog-theme", next ? "light" : "dark");
  }

  /* ── Date ranges ── */
  const calcRange = useCallback((): [string, string] => {
    if (calView === "day") { const s = fmtDate(pivot); return [s, s]; }
    if (calView === "week") {
      const s = weekStart(pivot);
      return [fmtDate(s), fmtDate(addDays(s, 6))];
    }
    const first = new Date(pivot.getFullYear(), pivot.getMonth(), 1);
    const last = new Date(pivot.getFullYear(), pivot.getMonth() + 1, 0);
    return [fmtDate(first), fmtDate(last)];
  }, [calView, pivot]);

  /* ── Load data ── */
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "calendar") {
        const [from, to] = calcRange();
        const data = await fetchAPI<Appt[]>(`/api/barber/appointments?from=${from}&to=${to}`);
        setAppts(data);
      } else if (tab === "list") {
        const st = listStatus !== "all" ? `&status=${listStatus}` : "";
        const data = await fetchAPI<Appt[]>(`/api/barber/appointments?from=2020-01-01&to=2099-12-31${st}`);
        setAppts(data);
      } else if (tab === "stats") {
        const to = new Date(); const from = new Date();
        from.setDate(from.getDate() - 30);
        const fromStr = fmtDate(from);
        const toStr = fmtDate(to);
        const statusParam = statsFilter !== "all" ? `&status=${statsFilter}` : "";
        const [statsData, allApptsData, filteredApptsData] = await Promise.all([
          fetchAPI<Stats>(`/api/barber/stats?from=${fromStr}&to=${toStr}`),
          fetchAPI<Appt[]>(`/api/barber/appointments?from=${fromStr}&to=${toStr}`),
          fetchAPI<Appt[]>(`/api/barber/appointments?from=${fromStr}&to=${toStr}${statusParam}`),
        ]);
        setStats(statsData);
        setStatsAllAppts(allApptsData);
        setStatsAppts(filteredApptsData);
      } else if (tab === "clients") {
        const data = await fetchAPI<Client[]>("/api/barber/clients");
        setClients(data);
      }
    } catch { /* silent */ } finally { setLoading(false); }
  }, [tab, calcRange, listStatus, statsFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    fetchAPI<Service[]>("/api/services")
      .then((data) => setServices(data.map((s) => ({ ...s, active: s.active ?? true })))
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchAPI<BizCfg>("/api/barber/settings")
      .then((cfg) => { setBizSettings(cfg); setSettingsForm(cfg); })
      .catch(() => {});
  }, []);

  // Load closed dates for settings month
  const settingsMonthStr = `${settingsMonth.getFullYear()}-${String(settingsMonth.getMonth() + 1).padStart(2, "0")}`;
  const loadClosedDates = useCallback(async () => {
    try {
      const data = await fetchAPI<{ closedDates: string[]; apptCounts: Record<string, number> }>(
        `/api/barber/closed-dates?month=${settingsMonthStr}`
      );
      setClosedDates(data.closedDates);
      setApptCounts(data.apptCounts);
    } catch { /* silent */ }
  }, [settingsMonthStr]);

  useEffect(() => { if (tab === "settings") loadClosedDates(); }, [tab, loadClosedDates]);

  /* ── Navigation ── */
  function navigate(dir: 1 | -1) {
    const nd = new Date(pivot);
    if (calView === "day") nd.setDate(nd.getDate() + dir);
    else if (calView === "week") nd.setDate(nd.getDate() + dir * 7);
    else nd.setMonth(nd.getMonth() + dir);
    setPivot(nd);
  }

  function pivotLabel() {
    if (calView === "day") {
      if (fmtDate(pivot) === todayStr()) return "Hoy";
      return pivot.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
    }
    if (calView === "week") {
      const s = weekStart(pivot);
      const e = addDays(s, 6);
      return `${s.getDate()} – ${e.getDate()} ${e.toLocaleDateString("es-ES", { month: "long", year: "numeric" })}`;
    }
    return pivot.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  }

  function apptsByDay(dateStr: string) {
    return appts.filter(a => getDateInMadrid(a.start_time) === dateStr);
  }

  /* ── Status change ── */
  async function markAppt(id: number, status: Status) {
    setDrawerBusy(true);
    setNotifyMsg("");
    try {
      await fetchAPI(`/api/barber/appointments/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await loadData();
      setSelectedAppt(prev => prev?.id === id ? { ...prev, status } : prev);
    } catch { /* silent */ } finally { setDrawerBusy(false); }
  }

  async function sendReminderFromDrawer(apptId: number) {
    setNotifyBusy(true);
    setNotifyMsg("");
    try {
      const result = await fetchAPI<{ ok: boolean; result: { email: string; whatsapp: string; errors: string[] } }>(
        `/api/barber/appointments/${apptId}/notify`,
        { method: "POST" }
      );
      setNotifyMsg(`Email: ${result.result.email} · WhatsApp: ${result.result.whatsapp}`);
    } catch (err: unknown) {
      setNotifyMsg(err instanceof Error ? err.message : "No se pudo enviar el recordatorio");
    } finally {
      setNotifyBusy(false);
    }
  }

  /* ── Create appt ── */
  async function submitAppt(e: React.FormEvent) {
    e.preventDefault();
    setModalErr("");
    setModalBusy(true);
    try {
      await fetchAPI("/api/barber/appointments", {
        method: "POST",
        body: JSON.stringify({
          serviceId: Number(modalForm.serviceId),
          date: modalForm.date,
          time: modalForm.time,
          clientName: modalForm.clientName,
          clientPhone: modalForm.clientPhone,
          clientEmail: modalForm.clientEmail || undefined,
          recurring: modalRecurring || undefined,
        }),
      });
      setModalOk(true);
      await loadData();
      setTimeout(() => { setShowModal(false); setModalOk(false); resetModal(); }, 1500);
    } catch (err: unknown) {
      setModalErr(err instanceof Error ? err.message : "Error al crear cita");
    } finally { setModalBusy(false); }
  }

  function resetModal() {
    setModalForm({ serviceId: "", date: todayStr(), time: "10:00", clientName: "", clientPhone: "", clientEmail: "" });
    setModalErr(""); setModalOk(false); setModalRecurring(false);
  }

  function openEditClient(c: Client) {
    setEditForm({
      name: c.name,
      phone: c.phone,
      email: c.email ?? "",
      observations: c.observations ?? "",
      preferredSlotMinutes: c.preferred_slot_minutes ? String(c.preferred_slot_minutes) : "",
    });
    setEditErr("");
    setClientToEdit(c);
  }

  async function saveClient() {
    if (!clientToEdit) return;
    setSavingClient(true); setEditErr("");
    try {
      await fetchAPI(`/api/barber/clients/${clientToEdit.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editForm.name,
          phone: editForm.phone,
          email: editForm.email || null,
          observations: editForm.observations || null,
          preferredSlotMinutes: editForm.preferredSlotMinutes ? Number(editForm.preferredSlotMinutes) : null,
        }),
      });
      setClientToEdit(null);
      await loadData();
    } catch (err: unknown) {
      setEditErr(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSavingClient(false);
    }
  }

  async function deleteClient(client: Client) {
    setClientActionErr("");
    setDeletingClientId(client.id);
    try {
      await fetchAPI(`/api/barber/clients/${client.id}`, { method: "DELETE" });
      setClientToDelete(null);
      await loadData();
    } catch (err: unknown) {
      setClientActionErr(err instanceof Error ? err.message : "No se pudo borrar el cliente");
    } finally {
      setDeletingClientId(null);
    }
  }

  function openNewApptAt(date: Date, hour: number) {
    setModalErr("");
    setModalOk(false);
    setModalRecurring(false);
    setModalForm(prev => ({
      ...prev,
      date: fmtDate(date),
      time: `${String(hour).padStart(2, "0")}:00`,
    }));
    setShowModal(true);
  }

  /* ── Save settings ── */
  async function saveSettings() {
    setSettingsBusy(true); setSettingsMsg("");
    try {
      const cfg = await fetchAPI<BizCfg>("/api/barber/settings", {
        method: "PUT",
        body: JSON.stringify(settingsForm),
      });
      setBizSettings(cfg); setSettingsForm(cfg);
      setSettingsMsg("Guardado");
      setTimeout(() => setSettingsMsg(""), 2000);
    } catch { setSettingsMsg("Error al guardar"); }
    finally { setSettingsBusy(false); }
  }

  /* ── Toggle closed date ── */
  async function toggleClosedDate(dateStr: string) {
    if (closedDates.includes(dateStr)) {
      // Reopen — just do it directly
      setCloseDateBusy(dateStr);
      try {
        await fetchAPI(`/api/barber/closed-dates/${dateStr}`, { method: "DELETE" });
        await loadClosedDates();
      } catch { /* silent */ }
      finally { setCloseDateBusy(null); }
    } else {
      // Close — show confirmation first
      const count = apptCounts[dateStr] || 0;
      setCloseConfirm({ date: dateStr, count });
    }
  }

  async function confirmCloseDate() {
    if (!closeConfirm) return;
    const dateStr = closeConfirm.date;
    setCloseDateBusy(dateStr);
    setCloseConfirm(null);
    try {
      const res = await fetchAPI<{ ok: boolean; date: string; affectedAppointments: {id:number; start_time:string; client_name:string; service_name:string; phone:string}[] }>(
        "/api/barber/closed-dates",
        { method: "POST", body: JSON.stringify({ date: dateStr }) }
      );
      if (res.affectedAppointments.length > 0) {
        setAffectedAppts({ date: dateStr, appts: res.affectedAppointments });
      }
      await loadClosedDates();
    } catch { /* silent */ }
    finally { setCloseDateBusy(null); }
  }

  async function notifyAffectedClients() {
    if (!affectedAppts) return;
    setNotifyBusy(true);
    try {
      const res = await fetchAPI<{ ok: boolean; date: string; notified: {id:number; client_name:string; whatsapp:string}[] }>(
        `/api/barber/closed-dates/${affectedAppts.date}/notify`,
        { method: "POST" }
      );
      setNotifyResult({ date: affectedAppts.date, results: res.notified });
      setAffectedAppts(null);
    } catch { /* silent */ }
    finally { setNotifyBusy(false); }
  }

  /* ── Drag & drop reschedule ── */
  function handleDragStart(a: Appt) {
    dragApptRef.current = a;
  }

  async function handleDrop(date: Date, hour: number, minute: number) {
    const a = dragApptRef.current;
    dragApptRef.current = null;
    if (!a) return;
    const newTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    const newDate = fmtDate(date);
    try {
      await fetchAPI(`/api/barber/appointments/${a.id}/reschedule`, {
        method: "PATCH",
        body: JSON.stringify({ date: newDate, time: newTime }),
      });
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error al mover cita");
    }
  }

  function handleKpiClick(filter: "all" | Status) {
    setStatsFilter(filter);
    setTimeout(() => {
      statsListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  function openStatsDetailItem(item: StatsDetailItem) {
    const match = statsAllAppts.find((a) =>
      a.status === item.status &&
      a.start_time === item.start_time &&
      a.client_name === item.client_name &&
      a.service_name === item.service_name
    );
    if (match) setSelectedAppt(match);
  }

  /* ──────────────────────── Calendar – Day ──────────────────────── */
  function renderDayView() {
    const dateStr = fmtDate(pivot);
    const dayAppts = apptsByDay(dateStr).filter(a => a.status !== "cancelled");
    const totalH = HOURS.length * HOUR_H;
    return (
      <div className="cal-day-wrap">
        <div className="cal-hours-col">
          {HOURS.map(h => (
            <div key={h} className="cal-hour-label">{String(h).padStart(2, "0")}:00</div>
          ))}
        </div>
        <div className="cal-day-events" style={{ position: "relative", height: totalH }}>
          {/* filas visuales + click para crear cita + drop target */}
          {HOURS.map(h => (
            <div
              key={h}
              className="cal-hour-row cal-hour-row--clickable"
              style={{ position: "absolute", top: (h - HOURS[0]) * HOUR_H, width: "100%" }}
              onClick={() => openNewApptAt(pivot, h)}
              onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("cal-hour-row--drag-over"); }}
              onDragLeave={e => { e.currentTarget.classList.remove("cal-hour-row--drag-over"); }}
              onDrop={e => {
                e.preventDefault();
                e.currentTarget.classList.remove("cal-hour-row--drag-over");
                const rect = e.currentTarget.getBoundingClientRect();
                const yOffset = e.clientY - rect.top;
                const minute = yOffset < HOUR_H / 2 ? 0 : 30;
                handleDrop(pivot, h, minute);
              }}
            />
          ))}
          {/* eventos posicionados absolutamente (draggable) */}
          {dayAppts.map(a => (
            <div
              key={a.id}
              className={`cal-event cal-event--${a.status}${a.duration <= 30 ? " cal-event--sm" : ""}`}
              style={{ position: "absolute", top: eventTop(a.start_time, HOURS[0]), height: eventHeight(a.duration), left: 6, right: 6 }}
              draggable={a.status === "pending"}
              onDragStart={() => handleDragStart(a)}
              onClick={(e) => { e.stopPropagation(); setSelectedAppt(a); }}
            >
              {a.duration <= 30 ? (
                <>
                  <span className="cal-ev-inline-time">{fmtTime(a.start_time)}</span>
                  <span className="cal-ev-inline-name">{a.client_name.split(" ")[0]}</span>
                </>
              ) : (
                <>
                  <span className="cal-ev-time">{fmtTime(a.start_time)}</span>
                  <span className="cal-ev-name">{a.client_name}</span>
                  <span className="cal-ev-svc">{a.service_name}</span>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ──────────────────────── Calendar – Week ──────────────────────── */
  function renderWeekView() {
    const start = weekStart(pivot);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const tStr = todayStr();
    return (
      <div className="cal-week-wrap">
        <div className="cal-week-header">
          <div className="cal-week-hcorner" />
          {days.map(d => (
            <div key={d.toISOString()} className={`cal-wdh ${fmtDate(d) === tStr ? "cal-wdh--today" : ""}`}>
              <span className="cal-wdh-name">{d.toLocaleDateString("es-ES", { weekday: "short" })}</span>
              <span
                className="cal-wdh-num"
                onClick={() => { setPivot(d); setCalView("day"); }}
              >{d.getDate()}</span>
            </div>
          ))}
        </div>
        <div className="cal-week-body">
          {HOURS.map(h => (
            <div key={h} className="cal-week-row">
              <div className="cal-week-hour-label">{String(h).padStart(2, "0")}:00</div>
              {days.map(d => {
                const ds = fmtDate(d);
                const cellAppts = apptsByDay(ds).filter(
                  a => getHourInMadrid(a.start_time) === h && a.status !== "cancelled"
                );
                return (
                  <div
                    key={ds}
                    className="cal-week-cell cal-week-cell--clickable"
                    style={{ position: "relative", overflow: "visible" }}
                    onClick={() => openNewApptAt(d, h)}
                    onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("cal-hour-row--drag-over"); }}
                    onDragLeave={e => { e.currentTarget.classList.remove("cal-hour-row--drag-over"); }}
                    onDrop={e => {
                      e.preventDefault();
                      e.currentTarget.classList.remove("cal-hour-row--drag-over");
                      const rect = e.currentTarget.getBoundingClientRect();
                      const yOffset = e.clientY - rect.top;
                      const minute = yOffset < HOUR_H / 2 ? 0 : 30;
                      handleDrop(d, h, minute);
                    }}
                  >
                    {cellAppts.map(a => (
                      <div
                        key={a.id}
                        className={`cal-event cal-event--${a.status}${a.duration <= 30 ? " cal-event--sm" : ""}`}
                        style={{
                          position: "absolute",
                          top: (getMinuteInMadrid(a.start_time) / 60) * HOUR_H,
                          height: eventHeight(a.duration),
                          left: 2, right: 2, zIndex: 2,
                        }}
                        draggable={a.status === "pending"}
                        onDragStart={() => handleDragStart(a)}
                        onClick={(e) => { e.stopPropagation(); setSelectedAppt(a); }}
                      >
                        {a.duration <= 30 ? (
                          <>
                            <span className="cal-ev-inline-time">{fmtTime(a.start_time)}</span>
                            <span className="cal-ev-inline-name">{a.client_name.split(" ")[0]}</span>
                          </>
                        ) : (
                          <>
                            <span className="cal-ev-time">{fmtTime(a.start_time)}</span>
                            <span className="cal-ev-name">{a.client_name.split(" ")[0]}</span>
                            <span className="cal-ev-svc">{a.service_name}</span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ──────────────────────── Calendar – Month ──────────────────────── */
  function renderMonthView() {
    const grid = monthGrid(pivot);
    const tStr = todayStr();
    const curMonth = pivot.getMonth();
    const DAY_NAMES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
    return (
      <div className="cal-month-wrap">
        <div className="cal-month-head">
          {DAY_NAMES.map(n => <div key={n} className="cal-month-dn">{n}</div>)}
        </div>
        <div className="cal-month-grid">
          {grid.map((week, wi) =>
            week.map((d, di) => {
              const ds = fmtDate(d);
              const dayAppts = apptsByDay(ds).filter(a => a.status !== "cancelled");
              const isToday = ds === tStr;
              const isCurrentMonth = d.getMonth() === curMonth;
              return (
                <div
                  key={`${wi}-${di}`}
                  className={`cal-month-cell${isToday ? " cal-month-cell--today" : ""}${!isCurrentMonth ? " cal-month-cell--other" : ""}`}
                  onClick={() => { setPivot(new Date(d)); setCalView("day"); }}
                >
                  <span className="cal-month-num">{d.getDate()}</span>
                  <div className="cal-month-events">
                    {dayAppts.slice(0, 3).map(a => (
                      <div key={a.id} className={`cal-month-event cal-month-event--${a.status}`}>
                        {fmtTime(a.start_time)} {a.client_name.split(" ")[0]}
                      </div>
                    ))}
                    {dayAppts.length > 3 && (
                      <div className="cal-month-more">+{dayAppts.length - 3} más</div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  /* ── Filtered lists ── */
  const filteredAppts = appts.filter(a => {
    if (!listSearch) return true;
    const q = listSearch.toLowerCase();
    return a.client_name.toLowerCase().includes(q) || a.phone.includes(q) || a.service_name.toLowerCase().includes(q);
  });

  const filteredClients = clients.filter(c => {
    if (!clientSearch) return true;
    const q = clientSearch.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.phone.includes(q) || (c.email || "").toLowerCase().includes(q);
  });

  /* ──────────────────────── Render ──────────────────────── */
  return (
    <div className="pp-root">

      {/* ── Sidebar ── */}
      <aside className="pp-sidebar">
        <div className="pp-brand">
          <span className="pp-brand-name">MOG</span>
          <span className="pp-brand-sub">Panel</span>
        </div>
        <nav className="pp-nav">
          {(["calendar", "list", "stats", "clients", "settings"] as Tab[]).map(t => {
            const labels: Record<Tab, string> = { calendar: "Calendario", list: "Listado", stats: "Estadísticas", clients: "Clientes", settings: "Ajustes" };
            return (
              <button key={t} className={`pp-nav-item${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
                <span className="pp-nav-label">{labels[t]}</span>
              </button>
            );
          })}
        </nav>
        <a href="/" className="pp-back-link">← Inicio</a>
        <button className="pp-theme-toggle" onClick={toggleTheme} title={isLight ? "Modo oscuro" : "Modo claro"}>
          {isLight ? "☽" : "☀️"}
        </button>
      </aside>

      {/* ── Main ── */}
      <main className="pp-main">

        {/* ━━━━ CALENDAR ━━━━ */}
        {tab === "calendar" && (
          <div className="pp-panel">
            <div className="pp-toolbar">
              <div className="pp-toolbar-left">
                <div className="pp-view-tabs">
                  {(["day", "week", "month"] as CalView[]).map(v => (
                    <button key={v} className={`pp-view-tab${calView === v ? " active" : ""}`} onClick={() => setCalView(v)}>
                      {{ day: "Día", week: "Semana", month: "Mes" }[v]}
                    </button>
                  ))}
                </div>
                <button className="pp-btn-ghost pp-btn-sm" onClick={() => { setPivot(new Date(todayStr())); }}>Hoy</button>
                <div className="pp-pivot-nav">
                  <button className="pp-icon-btn" onClick={() => navigate(-1)}><span className="pp-arrow"></span></button>
                  <span className="pp-pivot-label">{pivotLabel()}</span>
                  <button className="pp-icon-btn" onClick={() => navigate(1)}><span className="pp-arrow pp-arrow--right"></span></button>
                </div>
              </div>
              <button className="pp-btn-primary" onClick={() => setShowModal(true)}>+ Nueva cita</button>
            </div>
            {loading
              ? <div className="pp-loading">Cargando…</div>
              : <>
                  {calView === "day" && renderDayView()}
                  {calView === "week" && renderWeekView()}
                  {calView === "month" && renderMonthView()}
                </>
            }
          </div>
        )}

        {/* ━━━━ LIST ━━━━ */}
        {tab === "list" && (
          <div className="pp-panel">
            <div className="pp-toolbar">
              <h2 className="pp-section-title">Todas las citas</h2>
              <button className="pp-btn-primary" onClick={() => setShowModal(true)}>+ Nueva cita</button>
            </div>
            <div className="pp-list-filters">
              <select className="pp-select" value={listStatus} onChange={e => setListStatus(e.target.value)}>
                <option value="all">Todos los estados</option>
                <option value="pending">Pendiente</option>
                <option value="completed">Completada</option>
                <option value="no_show">No presentado</option>
                <option value="cancelled">Cancelada</option>
              </select>
              <input
                className="pp-search-inp"
                type="text"
                placeholder="Buscar cliente, tel, servicio…"
                value={listSearch}
                onChange={e => setListSearch(e.target.value)}
              />
            </div>
            {loading ? <div className="pp-loading">Cargando…</div> : (
              <div className="pp-table-wrap">
                <table className="pp-table">
                  <thead>
                    <tr>
                      <th>Fecha</th><th>Hora</th><th>Cliente</th><th>Teléfono</th>
                      <th>Servicio</th><th>€</th><th>Estado</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAppts.map(a => (
                      <tr key={a.id} className="pp-tr-click" onClick={() => setSelectedAppt(a)}>
                        <td>{fmtDateShort(a.start_time)}</td>
                        <td>{fmtTime(a.start_time)}</td>
                        <td className="pp-td-bold">{a.client_name}</td>
                        <td className="pp-td-muted">{a.phone}</td>
                        <td>{a.service_name}</td>
                        <td>{parseFloat(a.price).toFixed(0)}€</td>
                        <td><span className={`pp-badge pp-badge--${a.status}`}>{STATUS_LABEL[a.status]}</span></td>
                        <td><span className="pp-td-arrow"></span></td>
                      </tr>
                    ))}
                    {filteredAppts.length === 0 && (
                      <tr><td colSpan={8} className="pp-table-empty">Sin resultados</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ━━━━ STATS ━━━━ */}
        {tab === "stats" && (
          <div className="pp-panel">
            <div className="pp-toolbar">
              <h2 className="pp-section-title">Estadísticas — últimos 30 días</h2>
            </div>
            {loading || !stats ? <div className="pp-loading">Cargando…</div> : (
              <>
                <div className="pp-kpi-row">
                  <div className="pp-kpi pp-kpi--gold">
                    <span className="pp-kpi-val">{parseFloat(String(stats.totals.revenue || "0")).toFixed(0)}€</span>
                    <span className="pp-kpi-lbl">Ingresos</span>
                  </div>
                  <button className={`pp-kpi pp-kpi-btn${statsFilter === "all" ? " is-active" : ""}`} onClick={() => handleKpiClick("all")}>
                    <span className="pp-kpi-val">{stats.totals.total}</span>
                    <span className="pp-kpi-lbl">Total citas</span>
                  </button>
                  <button className={`pp-kpi pp-kpi--green pp-kpi-btn${statsFilter === "completed" ? " is-active" : ""}`} onClick={() => handleKpiClick("completed")}>
                    <span className="pp-kpi-val">{stats.totals.completed}</span>
                    <span className="pp-kpi-lbl">Completadas</span>
                  </button>
                  <button className={`pp-kpi pp-kpi--amber pp-kpi-btn${statsFilter === "pending" ? " is-active" : ""}`} onClick={() => handleKpiClick("pending")}>
                    <span className="pp-kpi-val">{stats.totals.pending}</span>
                    <span className="pp-kpi-lbl">Pendientes</span>
                  </button>
                  <button className={`pp-kpi pp-kpi--red pp-kpi-btn${statsFilter === "no_show" ? " is-active" : ""}`} onClick={() => handleKpiClick("no_show")}>
                    <span className="pp-kpi-val">{stats.totals.no_show}</span>
                    <span className="pp-kpi-lbl">No presentados</span>
                  </button>
                  <button className={`pp-kpi pp-kpi-btn${statsFilter === "cancelled" ? " is-active" : ""}`} onClick={() => handleKpiClick("cancelled")}>
                    <span className="pp-kpi-val">{stats.totals.cancelled}</span>
                    <span className="pp-kpi-lbl">Canceladas</span>
                  </button>
                </div>
                <div className="pp-stats-cols">
                  <div className="pp-stats-card">
                    <h3 className="pp-stats-title">Por servicio</h3>
                    <table className="pp-stats-table">
                      <thead><tr><th>Servicio</th><th>Citas</th><th>Ingresos</th></tr></thead>
                      <tbody>
                        {stats.byService.map(s => (
                          <tr key={s.service_name}>
                            <td>{s.service_name}</td>
                            <td>{s.count}</td>
                            <td>{parseFloat(s.revenue).toFixed(0)}€</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="pp-stats-chart-card">
                    <h3 className="pp-stats-title">Citas por día</h3>
                    <div className="pp-bar-chart">
                      {(() => {
                        const maxVal = Math.max(...stats.byDay.map(x => Number(x.count)), 1);
                        return stats.byDay.map(d => {
                          const pct = (Number(d.count) / maxVal) * 100;
                          return (
                            <div key={d.day} className="pp-bar-col">
                              <div className="pp-bar" style={{ height: `${pct}%` }} />
                              <span className="pp-bar-label">{new Date(d.day + "T12:00").getDate()}</span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                </div>
                <div className="pp-stats-detail-grid">
                  <div className="pp-stats-card">
                    <h3 className="pp-stats-title">No presentados (detalle)</h3>
                    <ul className="pp-detail-list">
                      {stats.noShowList.length === 0 && <li className="pp-detail-empty">Sin faltas en este periodo</li>}
                      {stats.noShowList.map((item, idx) => (
                        <li key={`${item.client_name}-${item.start_time}-${idx}`}>
                          <button className="pp-detail-btn" onClick={() => openStatsDetailItem(item)}>
                            <span className="pp-detail-main">{item.client_name}</span>
                            <span className="pp-detail-sub">{item.service_name} · {fmtDateTimeShort(item.start_time)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="pp-stats-card">
                    <h3 className="pp-stats-title">Pendientes (próximas)</h3>
                    <ul className="pp-detail-list">
                      {stats.pendingList.length === 0 && <li className="pp-detail-empty">Sin citas pendientes</li>}
                      {stats.pendingList.map((item, idx) => (
                        <li key={`${item.client_name}-${item.start_time}-${idx}`}>
                          <button className="pp-detail-btn" onClick={() => openStatsDetailItem(item)}>
                            <span className="pp-detail-main">{item.client_name}</span>
                            <span className="pp-detail-sub">{item.service_name} · {fmtDateTimeShort(item.start_time)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="pp-stats-card">
                    <h3 className="pp-stats-title">Canceladas (detalle)</h3>
                    <ul className="pp-detail-list">
                      {stats.cancelledList.length === 0 && <li className="pp-detail-empty">Sin cancelaciones</li>}
                      {stats.cancelledList.map((item, idx) => (
                        <li key={`${item.client_name}-${item.start_time}-${idx}`}>
                          <button className="pp-detail-btn" onClick={() => openStatsDetailItem(item)}>
                            <span className="pp-detail-main">{item.client_name}</span>
                            <span className="pp-detail-sub">{item.service_name} · {fmtDateTimeShort(item.start_time)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="pp-stats-card pp-stats-list-card" ref={statsListRef}>
                  <h3 className="pp-stats-title">
                    Listado completo ({statsFilter === "all" ? "todas" : STATUS_LABEL[statsFilter]})
                  </h3>
                  <div className="pp-table-wrap">
                    <table className="pp-table">
                      <thead>
                        <tr>
                          <th>Fecha</th><th>Hora</th><th>Cliente</th><th>Teléfono</th>
                          <th>Servicio</th><th>€</th><th>Estado</th><th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {statsAppts.map(a => (
                          <tr key={a.id} className="pp-tr-click" onClick={() => setSelectedAppt(a)}>
                            <td>{fmtDateShort(a.start_time)}</td>
                            <td>{fmtTime(a.start_time)}</td>
                            <td className="pp-td-bold">{a.client_name}</td>
                            <td className="pp-td-muted">{a.phone}</td>
                            <td>{a.service_name}</td>
                            <td>{parseFloat(a.price).toFixed(0)}€</td>
                            <td><span className={`pp-badge pp-badge--${a.status}`}>{STATUS_LABEL[a.status]}</span></td>
                            <td><span className="pp-td-arrow"></span></td>
                          </tr>
                        ))}
                        {statsAppts.length === 0 && (
                          <tr><td colSpan={8} className="pp-table-empty">Sin citas para este filtro</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ━━━━ CLIENTS ━━━━ */}
        {tab === "clients" && (
          <div className="pp-panel">
            <div className="pp-toolbar">
              <h2 className="pp-section-title">Clientes ({clients.length})</h2>
              <input
                className="pp-search-inp"
                type="text"
                placeholder="Buscar nombre, tel, email…"
                value={clientSearch}
                onChange={e => setClientSearch(e.target.value)}
              />
            </div>
            {loading ? <div className="pp-loading">Cargando…</div> : (
              <div className="pp-table-wrap">
                <table className="pp-table">
                  <thead>
                    <tr>
                      <th>Nombre</th><th>Teléfono</th><th>Email</th>
                      <th>Obs.</th><th>Min.</th><th>Citas</th><th>Completadas</th><th>Faltas</th><th>Última visita</th><th>Registrado</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredClients.map(c => (
                      <tr key={c.id}>
                        <td className="pp-td-bold">{c.name}</td>
                        <td className="pp-td-muted">{c.phone}</td>
                        <td className="pp-td-muted">{c.email || "—"}</td>
                        <td className="pp-td-muted">{c.observations ? "Sí" : "—"}</td>
                        <td>{c.preferred_slot_minutes ? `${c.preferred_slot_minutes}m` : "—"}</td>
                        <td>{c.total_appts}</td>
                        <td>{c.completed_appts}</td>
                        <td><span className="pp-no-show-pill">{c.no_show_appts}</span></td>
                        <td>{c.last_appt ? fmtDateShort(c.last_appt) : "—"}</td>
                        <td className="pp-td-muted">{fmtDateShort(c.created_at)}</td>
                        <td className="pp-td-actions">
                          <button className="pp-btn-link" onClick={() => openEditClient(c)}>Editar</button>
                          <button className="pp-btn-link-danger" onClick={() => setClientToDelete(c)}>Borrar</button>
                        </td>
                      </tr>
                    ))}
                    {filteredClients.length === 0 && (
                      <tr><td colSpan={11} className="pp-table-empty">Sin clientes</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ━━━━ SETTINGS ━━━━ */}
        {tab === "settings" && (
          <div className="pp-panel">
            <div className="pp-toolbar">
              <h2 className="pp-section-title">Ajustes del negocio</h2>
            </div>

            {/* ── Turnos ── */}
            <h3 className="pp-settings-subtitle">Turnos de trabajo</h3>
            <div className="pp-shifts-grid">
              {settingsForm.shifts.map((sh, idx) => (
                <div key={idx} className="pp-shift-card">
                  <span className="pp-shift-label">Turno {idx + 1}{idx === 0 ? " (Mañana)" : " (Tarde)"}</span>
                  <div className="pp-shift-times">
                    <select className="pp-form-input" value={sh.start}
                      onChange={e => {
                        const ns = [...settingsForm.shifts];
                        ns[idx] = { ...ns[idx], start: Number(e.target.value) };
                        setSettingsForm(f => ({ ...f, shifts: ns }));
                      }}>
                      {Array.from({ length: 18 }, (_, i) => i + 6).map(h => (
                        <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                      ))}
                    </select>
                    <span className="pp-shift-sep">—</span>
                    <select className="pp-form-input" value={sh.end}
                      onChange={e => {
                        const ns = [...settingsForm.shifts];
                        ns[idx] = { ...ns[idx], end: Number(e.target.value) };
                        setSettingsForm(f => ({ ...f, shifts: ns }));
                      }}>
                      {Array.from({ length: 18 }, (_, i) => i + 7).map(h => (
                        <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>

            {/* ── Días laborables ── */}
            <h3 className="pp-settings-subtitle">Días laborables</h3>
            <div className="pp-workdays-row">
              {([
                [1, "Lun"], [2, "Mar"], [3, "Mié"], [4, "Jue"], [5, "Vie"], [6, "Sáb"], [7, "Dom"],
              ] as [number, string][]).map(([n, label]) => (
                <label key={n} className={`pp-day-chip${settingsForm.workDays.includes(n) ? " active" : ""}`}>
                  <input
                    type="checkbox"
                    checked={settingsForm.workDays.includes(n)}
                    onChange={() => {
                      setSettingsForm(f => ({
                        ...f,
                        workDays: f.workDays.includes(n) ? f.workDays.filter(d => d !== n) : [...f.workDays, n].sort(),
                      }));
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>

            <div style={{ marginTop: "1rem" }}>
              <button className="pp-btn-primary" onClick={saveSettings} disabled={settingsBusy}>
                {settingsBusy ? "Guardando…" : "Guardar turnos y días"}
              </button>
              {settingsMsg && <span className="pp-inline-note" style={{ marginLeft: 12 }}>{settingsMsg}</span>}
            </div>

            {/* ── Calendario de días cerrados ── */}
            <h3 className="pp-settings-subtitle" style={{ marginTop: "2rem" }}>Días cerrados — {settingsMonth.toLocaleDateString("es-ES", { month: "long", year: "numeric" })}</h3>
            <p className="pp-settings-hint">Haz clic en un día para cerrarlo o reabrirlo. Los días con citas pendientes se marcan con un punto naranja.</p>

            <div className="pp-closed-nav">
              <button className="pp-icon-btn" onClick={() => setSettingsMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}><span className="pp-arrow"></span></button>
              <span className="pp-closed-month-label">
                {settingsMonth.toLocaleDateString("es-ES", { month: "long", year: "numeric" })}
              </span>
              <button className="pp-icon-btn" onClick={() => setSettingsMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}><span className="pp-arrow pp-arrow--right"></span></button>
            </div>

            <div className="pp-closed-cal">
              <div className="pp-closed-cal-head">
                {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map(n => <div key={n} className="pp-closed-cal-dn">{n}</div>)}
              </div>
              <div className="pp-closed-cal-grid">
                {(() => {
                  const first = new Date(settingsMonth.getFullYear(), settingsMonth.getMonth(), 1);
                  const lastDate = new Date(settingsMonth.getFullYear(), settingsMonth.getMonth() + 1, 0).getDate();
                  const startDow = first.getDay() === 0 ? 6 : first.getDay() - 1; // Mon=0
                  const cells: React.ReactNode[] = [];
                  // leading empties
                  for (let i = 0; i < startDow; i++) cells.push(<div key={`e${i}`} className="pp-closed-cal-cell pp-closed-cal-cell--empty" />);
                  for (let d = 1; d <= lastDate; d++) {
                    const dt = new Date(settingsMonth.getFullYear(), settingsMonth.getMonth(), d);
                    const ds = fmtDate(dt);
                    const jsDay = dt.getDay();
                    const isoDay = jsDay === 0 ? 7 : jsDay;
                    const isWorkDay = settingsForm.workDays.includes(isoDay);
                    const isClosed = closedDates.includes(ds);
                    const apptCount = apptCounts[ds] || 0;
                    const busy = closeDateBusy === ds;
                    const isToday = ds === todayStr();
                    cells.push(
                      <button
                        key={ds}
                        className={`pp-closed-cal-cell${isClosed ? " closed" : ""}${!isWorkDay ? " non-work" : ""}${isToday ? " today" : ""}`}
                        disabled={!isWorkDay || busy}
                        onClick={() => isWorkDay && toggleClosedDate(ds)}
                      >
                        <span className="pp-cc-num">{d}</span>
                        {apptCount > 0 && <span className={`pp-cc-dot${isClosed ? " pp-cc-dot--warn" : ""}`}>{apptCount}</span>}
                        {isClosed && <span className="pp-cc-x">✕</span>}
                      </button>
                    );
                  }
                  return cells;
                })()}
              </div>
            </div>
          </div>
        )}

        {/* ── Confirmation modal before closing a day ── */}
        {closeConfirm && (
          <div className="pp-modal-overlay" onClick={() => setCloseConfirm(null)}>
            <div className="pp-modal" onClick={e => e.stopPropagation()}>
              <div className="pp-drawer-header">
                <h3>⚠️ ¿Cerrar día?</h3>
                <button className="pp-close-btn" onClick={() => setCloseConfirm(null)}></button>
              </div>
              <div className="pp-modal-form">
                <p className="pp-confirm-copy">
                  ¿Estás seguro de que quieres cerrar el <strong>{new Date(closeConfirm.date + "T12:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}</strong>?
                  No se podrán reservar citas ese día.
                </p>
                {closeConfirm.count > 0 && (
                  <p className="pp-confirm-copy" style={{ color: "var(--danger)", fontWeight: 600 }}>
                    ⚠️ Hay <strong>{closeConfirm.count} citas</strong> pendientes ese día. Al cerrar se te pedirá que notifiques a los clientes.
                  </p>
                )}
                <div className="pp-modal-footer" style={{ display: "flex", gap: "0.7rem" }}>
                  <button className="pp-btn-primary" onClick={confirmCloseDate}>Sí, cerrar día</button>
                  <button className="pp-btn-secondary" onClick={() => setCloseConfirm(null)}>Cancelar</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Affected appointments modal with WhatsApp notification ── */}
        {affectedAppts && affectedAppts.appts.length > 0 && (
          <div className="pp-modal-overlay" onClick={() => setAffectedAppts(null)}>
            <div className="pp-modal" onClick={e => e.stopPropagation()}>
              <div className="pp-drawer-header">
                <h3>⚠️ Citas afectadas — {new Date(affectedAppts.date + "T12:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}</h3>
                <button className="pp-close-btn" onClick={() => setAffectedAppts(null)}></button>
              </div>
              <div className="pp-modal-form">
                <p className="pp-confirm-copy">
                  Has cerrado este día. Las siguientes <strong>{affectedAppts.appts.length} citas</strong> pendientes necesitan ser reprogramadas:
                </p>
                <div className="pp-affected-list">
                  {affectedAppts.appts.map(a => (
                    <div key={a.id} className="pp-affected-row">
                      <span className="pp-affected-time">{new Date(a.start_time).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" })}</span>
                      <span className="pp-affected-name">{a.client_name}</span>
                      <span className="pp-affected-svc">{a.service_name}</span>
                      <span className="pp-affected-phone">{a.phone}</span>
                    </div>
                  ))}
                </div>
                <div className="pp-modal-footer" style={{ display: "flex", gap: "0.7rem", flexWrap: "wrap" }}>
                  <button className="pp-btn-primary" onClick={notifyAffectedClients} disabled={notifyBusy} style={{ background: "#25D366", borderColor: "#25D366" }}>
                    {notifyBusy ? "Enviando…" : `Notificar vía WhatsApp (${affectedAppts.appts.length})`}
                  </button>
                  <button className="pp-btn-secondary" onClick={() => setAffectedAppts(null)}>Cerrar sin notificar</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Notification results modal ── */}
        {notifyResult && (
          <div className="pp-modal-overlay" onClick={() => setNotifyResult(null)}>
            <div className="pp-modal" onClick={e => e.stopPropagation()}>
              <div className="pp-drawer-header">
                <h3>📲 Resultado de notificaciones</h3>
                <button className="pp-close-btn" onClick={() => setNotifyResult(null)}></button>
              </div>
              <div className="pp-modal-form">
                <div className="pp-affected-list">
                  {notifyResult.results.map(r => (
                    <div key={r.id} className="pp-affected-row">
                      <span className="pp-affected-name">{r.client_name}</span>
                      <span style={{ fontSize: "0.82rem", color: r.whatsapp === "sent" ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>
                        {r.whatsapp === "sent" ? "✓ Enviado" : "✗ Error"}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="pp-modal-footer">
                  <button className="pp-btn-primary" onClick={() => setNotifyResult(null)}>Entendido</button>
                </div>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* ━━━━ APPOINTMENT DRAWER ━━━━ */}
      {selectedAppt && (
        <div className="pp-drawer-overlay" onClick={() => setSelectedAppt(null)}>
          <div className="pp-drawer" onClick={e => e.stopPropagation()}>
            <div className="pp-drawer-header">
              <h3>Detalle de cita</h3>
              <button className="pp-close-btn" onClick={() => setSelectedAppt(null)}></button>
            </div>
            <div className="pp-drawer-body">
              <span className={`pp-badge pp-badge--${selectedAppt.status} pp-badge--lg`}>
                {STATUS_LABEL[selectedAppt.status]}
              </span>
              <dl className="pp-drawer-dl">
                <dt>Cliente</dt><dd>{selectedAppt.client_name}</dd>
                <dt>Teléfono</dt><dd>{selectedAppt.phone}</dd>
                {selectedAppt.email && <><dt>Email</dt><dd>{selectedAppt.email}</dd></>}
                <dt>Servicio</dt><dd>{selectedAppt.service_name}</dd>
                <dt>Fecha</dt><dd>{fmtDateLong(new Date(selectedAppt.start_time))}</dd>
                <dt>Hora</dt><dd>{fmtTime(selectedAppt.start_time)} – {fmtTime(selectedAppt.end_time)}</dd>
                <dt>Precio</dt><dd>{parseFloat(selectedAppt.price).toFixed(2)}€</dd>
                <dt>Ref.</dt><dd className="pp-token">{selectedAppt.token}</dd>
              </dl>
              <div className="pp-drawer-actions">
                <button className="pp-btn-primary" disabled={notifyBusy || drawerBusy} onClick={() => sendReminderFromDrawer(selectedAppt.id)}>
                  {notifyBusy ? "Enviando…" : "Enviar recordatorio"}
                </button>
                {selectedAppt.status !== "completed" && (
                  <button className="pp-btn-success" disabled={drawerBusy} onClick={() => markAppt(selectedAppt.id, "completed")}>Completada</button>
                )}
                {selectedAppt.status !== "pending" && (
                  <button className="pp-btn-ghost" disabled={drawerBusy} onClick={() => markAppt(selectedAppt.id, "pending")}>Pendiente</button>
                )}
                {selectedAppt.status !== "no_show" && (
                  <button className="pp-btn-warning" disabled={drawerBusy} onClick={() => markAppt(selectedAppt.id, "no_show")}>No presentado</button>
                )}
                {selectedAppt.status !== "cancelled" && (
                  <button className="pp-btn-danger" disabled={drawerBusy} onClick={() => markAppt(selectedAppt.id, "cancelled")}>Cancelar</button>
                )}
              </div>
              {notifyMsg && <div className="pp-inline-note">{notifyMsg}</div>}
            </div>
          </div>
        </div>
      )}

      {/* ━━━━ NEW APPT MODAL ━━━━ */}
      {showModal && (
        <div className="pp-modal-overlay" onClick={() => { setShowModal(false); resetModal(); }}>
          <div className="pp-modal" onClick={e => e.stopPropagation()}>
            <div className="pp-drawer-header">
              <h3>Nueva cita</h3>
              <button className="pp-close-btn" onClick={() => { setShowModal(false); resetModal(); }}></button>
            </div>
            {modalOk ? (
              <div className="pp-success-banner">Cita creada correctamente</div>
            ) : (
              <form onSubmit={submitAppt} className="pp-modal-form">
                <div className="pp-form-row-2">
                  <div className="pp-form-group">
                    <label className="pp-form-label">Cliente *</label>
                    <input className="pp-form-input" required value={modalForm.clientName}
                      onChange={e => setModalForm(f => ({ ...f, clientName: e.target.value }))}
                      placeholder="Nombre completo" />
                  </div>
                  <div className="pp-form-group">
                    <label className="pp-form-label">Teléfono *</label>
                    <input className="pp-form-input" required value={modalForm.clientPhone}
                      onChange={e => setModalForm(f => ({ ...f, clientPhone: e.target.value }))}
                      placeholder="612345678" />
                  </div>
                </div>
                <div className="pp-form-group">
                  <label className="pp-form-label">Email</label>
                  <input className="pp-form-input" type="email" value={modalForm.clientEmail}
                    onChange={e => setModalForm(f => ({ ...f, clientEmail: e.target.value }))}
                    placeholder="opcional" />
                </div>
                <div className="pp-form-row-3">
                  <div className="pp-form-group">
                    <label className="pp-form-label">Servicio *</label>
                    <select className="pp-form-input" required value={modalForm.serviceId}
                      onChange={e => setModalForm(f => ({ ...f, serviceId: e.target.value }))}>
                      <option value="">Seleccionar…</option>
                      {services.map(s => (
                        <option key={s.id} value={s.id}>{s.name} — {parseFloat(s.price).toFixed(0)}€</option>
                      ))}
                    </select>
                  </div>
                  <div className="pp-form-group">
                    <label className="pp-form-label">Fecha *</label>
                    <input className="pp-form-input" type="date" required value={modalForm.date}
                      onChange={e => setModalForm(f => ({ ...f, date: e.target.value }))} />
                  </div>
                  <div className="pp-form-group">
                    <label className="pp-form-label">Hora *</label>
                    <input className="pp-form-input" type="time" required value={modalForm.time}
                      onChange={e => setModalForm(f => ({ ...f, time: e.target.value }))} />
                  </div>
                </div>
                <label className="pp-form-check">
                  <input type="checkbox" checked={modalRecurring}
                    onChange={e => setModalRecurring(e.target.checked)} />
                  <span>Recurrente (semanal, 1 año)</span>
                </label>
                {modalErr && <div className="error-banner">{modalErr}</div>}
                <div className="pp-modal-footer">
                  <button type="button" className="pp-btn-ghost" onClick={() => { setShowModal(false); resetModal(); }}>Cancelar</button>
                  <button type="submit" className="pp-btn-primary" disabled={modalBusy}>
                    {modalBusy ? "Creando…" : "Crear cita"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ━━━━ DELETE CLIENT MODAL ━━━━ */}
      {clientToDelete && (
        <div className="pp-modal-overlay" onClick={() => { if (!deletingClientId) { setClientToDelete(null); setClientActionErr(""); } }}>
          <div className="pp-modal pp-modal--sm" onClick={e => e.stopPropagation()}>
            <div className="pp-drawer-header">
              <h3>Borrar cliente</h3>
              <button className="pp-close-btn" onClick={() => { if (!deletingClientId) { setClientToDelete(null); setClientActionErr(""); } }}></button>
            </div>
            <div className="pp-modal-form">
              <p className="pp-confirm-copy">
                Vas a borrar a <strong>{clientToDelete.name}</strong> y sus citas asociadas.
              </p>
              {clientActionErr && <div className="error-banner">{clientActionErr}</div>}
              <div className="pp-modal-footer">
                <button
                  type="button"
                  className="pp-btn-ghost"
                  onClick={() => { setClientToDelete(null); setClientActionErr(""); }}
                  disabled={deletingClientId === clientToDelete.id}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="pp-btn-danger"
                  onClick={() => deleteClient(clientToDelete)}
                  disabled={deletingClientId === clientToDelete.id}
                >
                  {deletingClientId === clientToDelete.id ? "Borrando…" : "Confirmar borrado"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ━━━━ EDIT CLIENT MODAL ━━━━ */}
      {clientToEdit && (
        <div className="pp-modal-overlay" onClick={() => { if (!savingClient) setClientToEdit(null); }}>
          <div className="pp-modal pp-modal--sm" onClick={e => e.stopPropagation()}>
            <div className="pp-drawer-header">
              <h3>Editar cliente</h3>
              <button className="pp-close-btn" onClick={() => { if (!savingClient) setClientToEdit(null); }}></button>
            </div>
            <div className="pp-modal-form">
              <div className="pp-form-group">
                <label className="pp-form-label">Nombre *</label>
                <input className="pp-form-input" type="text" value={editForm.name}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="pp-form-group">
                <label className="pp-form-label">Teléfono *</label>
                <input className="pp-form-input" type="tel" value={editForm.phone}
                  onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="pp-form-group">
                <label className="pp-form-label">Email</label>
                <input className="pp-form-input" type="email" value={editForm.email}
                  onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="pp-form-row-2">
                <div className="pp-form-group">
                  <label className="pp-form-label">Minutos preferidos</label>
                  <select
                    className="pp-form-input"
                    value={editForm.preferredSlotMinutes}
                    onChange={e => setEditForm(f => ({ ...f, preferredSlotMinutes: e.target.value }))}
                  >
                    <option value="">Sin preferencia</option>
                    <option value="15">15 min</option>
                    <option value="30">30 min</option>
                    <option value="45">45 min</option>
                    <option value="60">60 min</option>
                  </select>
                </div>
                <div className="pp-form-group">
                  <label className="pp-form-label">Se aplica desde</label>
                  <input className="pp-form-input" value="2º corte (tras 1 completado)" disabled />
                </div>
              </div>
              <div className="pp-form-group">
                <label className="pp-form-label">Observaciones (barbero)</label>
                <textarea
                  className="pp-form-input"
                  rows={4}
                  value={editForm.observations}
                  onChange={e => setEditForm(f => ({ ...f, observations: e.target.value }))}
                  placeholder="Ej: remolino lateral, degradado bajo, mejor 15 min para mantenimiento..."
                />
              </div>
              {editErr && <div className="error-banner">{editErr}</div>}
              <div className="pp-modal-footer">
                <button type="button" className="pp-btn-ghost" onClick={() => setClientToEdit(null)} disabled={savingClient}>Cancelar</button>
                <button type="button" className="pp-btn-primary" onClick={saveClient} disabled={savingClient || !editForm.name.trim() || !editForm.phone.trim()}>
                  {savingClient ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ━━━━ SCROLL TO TOP ━━━━ */}
      <button
        className="pp-scroll-top"
        aria-label="Volver arriba"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      >
        ↑
      </button>

    </div>
  );
}
