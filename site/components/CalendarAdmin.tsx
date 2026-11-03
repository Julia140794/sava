"use client";
import { useState } from "react";
import {
  calendarServices,
  staff,
  minskDate,
  timeLabel,
  maxCalendarDate,
} from "@/lib/calendar";
type Item = {
  id: string;
  lead_id: string | null;
  kind: string;
  state: string;
  staff_id: string;
  service_id: string;
  starts_at: string;
  ends_at: string;
  leads: { name: string; phone: string } | null;
};
export default function CalendarAdmin() {
  const [secret, setSecret] = useState(""),
    [date, setDate] = useState(minskDate()),
    [items, setItems] = useState<Item[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  async function call(payload: Record<string, unknown>) {
    const r = await fetch("/api/calendar/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: secret.trim(), ...payload }),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || "Ошибка");
    return d;
  }
  async function load() {
    setBusy(true);
    try {
      const d = await call({ action: "list", date });
      setItems(d.appointments || []);
      setLoaded(true);
      setMessage("Расписание загружено");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }
  async function action(payload: Record<string, unknown>) {
    if (
      (payload.action === "cancel" || payload.action === "cancelBlock") &&
      !window.confirm("Отменить запись / закрытый интервал и освободить время?")
    )
      return;
    setBusy(true);
    try {
      const d = await call(payload);
      const fresh = await call({ action: "list", date });
      setItems(fresh.appointments || []);
      setMessage(
        d.message ||
          (payload.action === "cancel"
            ? `Запись отменена. ${d.notified ? "Клиент уведомлён в Telegram." : "При необходимости свяжитесь с клиентом по телефону."}`
            : "Готово"),
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p>
        Доступ владельцу по существующему секрету TELEGRAM_WEBHOOK_SECRET. Он
        используется только для этого сеанса и не сохраняется в браузере. Даты и
        время — по Минску.
      </p>
      <form
        className="setup-form"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <label htmlFor="calendar-secret">Секрет владельца</label>
        <input
          type="password"
          id="calendar-secret"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoComplete="off"
          required
        />
        <label htmlFor="admin-date">День расписания</label>
        <input
          type="date"
          id="admin-date"
          disabled={busy}
          min={minskDate()}
          max={maxCalendarDate()}
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setLoaded(false);
            setItems([]);
          }}
          required
        />
        <div className="setup-actions">
          <button disabled={busy}>Показать расписание</button>
        </div>
      </form>
      <p role="status">{message}</p>
      {loaded && (
        <div className="admin-appointments">
          {items.length === 0 ? (
            <p>На этот день записей и закрытых интервалов нет</p>
          ) : (
            items.map((a) => (
              <article key={a.id}>
                <h2>
                  {staff.find((s) => s.id === a.staff_id)?.name}:{" "}
                  {timeLabel(a.starts_at)}–{timeLabel(a.ends_at)}
                </h2>
                <p>
                  {a.kind === "block"
                    ? "Закрытое время"
                    : calendarServices.find((s) => s.id === a.service_id)
                        ?.name}{" "}
                  —{" "}
                  {a.state === "cancelled"
                    ? "отменено"
                    : a.state === "confirmed"
                      ? "подтверждено"
                      : "ожидает подтверждения"}
                </p>
                {a.leads && (
                  <p>
                    {a.leads.name} ·{" "}
                    <a href={"tel:" + a.leads.phone.replace(/[^+0-9]/g, "")}>
                      {a.leads.phone}
                    </a>
                  </p>
                )}
                {a.state !== "cancelled" && (
                  <div className="setup-actions">
                    {a.kind === "booking" && a.state === "pending" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          action({ action: "confirm", leadId: a.lead_id })
                        }
                      >
                        Подтвердить вручную
                      </button>
                    )}
                    <button
                      disabled={busy}
                      onClick={() =>
                        action(
                          a.kind === "block"
                            ? { action: "cancelBlock", id: a.id }
                            : { action: "cancel", leadId: a.lead_id },
                        )
                      }
                    >
                      Отменить и освободить время
                    </button>
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      )}
      <h2>Закрыть время мастера</h2>
      <p>
        Сначала внесите сюда уже существующие визиты, обеды, выходные и отпуск.
        Закрытые интервалы недоступны клиентам. Чужие занятые интервалы система
        не перезаписывает.
      </p>
      <form
        className="setup-form"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          action({
            action: "block",
            staff: data.get("staff"),
            from: data.get("from"),
            to: data.get("to"),
          });
        }}
      >
        <label htmlFor="block-staff">Мастер</label>
        <select id="block-staff" name="staff">
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label htmlFor="block-from">Начало (Минск)</label>
        <input type="datetime-local" id="block-from" name="from" required />
        <label htmlFor="block-to">Конец (Минск)</label>
        <input type="datetime-local" id="block-to" name="to" required />
        <div className="setup-actions">
          <button disabled={busy || !secret}>Закрыть интервал</button>
        </div>
      </form>
    </>
  );
}
