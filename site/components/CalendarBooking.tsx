"use client";
import { useEffect, useState } from "react";
import {
  calendarServices,
  staff,
  minskDate,
  maxCalendarDate,
  timeLabel,
} from "@/lib/calendar";
import { Arrow } from "@/components/Icons";
import { contact } from "@/lib/studio";
export default function CalendarBooking({ ready }: { ready: boolean }) {
  const [group, setGroup] = useState(""),
    [variant, setVariant] = useState(""),
    [master, setMaster] = useState(""),
    [date, setDate] = useState(""),
    [slot, setSlot] = useState(""),
    [slotResult, setSlotResult] = useState<{
      query: string;
      slots: string[];
      error: string;
    }>({ query: "", slots: [], error: "" }),
    [status, setStatus] = useState<"idle" | "sending" | "success" | "error">(
      "idle",
    ),
    [message, setMessage] = useState(""),
    [telegramUrl, setTelegramUrl] = useState<string | null>(null),
    [reload, setReload] = useState(0),
    [key, setKey] = useState("");
  const selected = calendarServices.find((s) => s.id === variant),
    groups = calendarServices.filter(
      (s, i, a) => a.findIndex((x) => x.group === s.group) === i,
    ),
    variants = calendarServices.filter((s) => s.group === group);
  const query = `${variant}|${master}|${date}|${reload}`;
  const loading = Boolean(
    variant && master && date && slotResult.query !== query,
  );
  const slots = slotResult.query === query ? slotResult.slots : [];
  const loadError = slotResult.query === query ? slotResult.error : "";
  function chooseGroup(value: string) {
    setGroup(value);
    const first = calendarServices.find((s) => s.group === value);
    setVariant(first?.id || "");
    setMaster(first?.staff.length === 1 ? first.staff[0] : "");
    setSlot("");
    setStatus("idle");
  }
  useEffect(() => {
    const h = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      chooseGroup(
        id === "manicure"
          ? "manicure-bare"
          : id === "pedicure"
            ? "pedicure-bare"
            : id,
      );
    };
    window.addEventListener("sava:service", h);
    return () => window.removeEventListener("sava:service", h);
  }, []);
  useEffect(() => {
    if (!variant || !master || !date) return;
    const controller = new AbortController();
    fetch(
      `/api/calendar?service=${encodeURIComponent(variant)}&staff=${encodeURIComponent(master)}&date=${encodeURIComponent(date)}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw Error(data.error || "Не удалось загрузить время");
        if (!controller.signal.aborted)
          setSlotResult({ query, slots: data.slots || [], error: "" });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setSlotResult({
            query,
            slots: [],
            error:
              e instanceof Error ? e.message : "Не удалось загрузить время",
          });
      });
    return () => controller.abort();
  }, [variant, master, date, reload, query]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ready || !slot || status === "sending") return;
    const form = e.currentTarget,
      data = new FormData(form);
    setStatus("sending");
    setMessage("");
    try {
      const utm = Object.fromEntries(
        [...new URLSearchParams(location.search)].filter(([k]) =>
          /^utm_(source|medium|campaign|term|content)$/.test(k),
        ),
      );
      const res = await fetch("/api/calendar/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          phone: data.get("phone"),
          comment: data.get("comment"),
          website: data.get("website"),
          consent: data.get("consent") === "on",
          page: location.origin + location.pathname,
          utm,
          service: variant,
          staff: master,
          startsAt: slot,
          requestKey: key,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          setSlot("");
          setReload((x) => x + 1);
        }
        throw Error(result.error || "Не удалось отправить запись");
      }
      if (result.telegramUrl) {
        const url = new URL(result.telegramUrl);
        if (
          url.origin === "https://t.me" &&
          /^\/[A-Za-z0-9_]{5,32}$/.test(url.pathname)
        )
          setTelegramUrl(url.href);
      }
      setStatus("success");
      setMessage(
        `${result.appointment.service}, ${result.appointment.master}: ${new Intl.DateTimeFormat("ru-BY", { timeZone: "Europe/Minsk", dateStyle: "long", timeStyle: "short" }).format(new Date(result.appointment.startsAt))}. Время удерживается. Ожидайте подтверждения студии.`,
      );
    } catch (e) {
      setStatus("error");
      setMessage(
        e instanceof Error ? e.message : "Не удалось отправить запись",
      );
    }
  }
  if (status === "success")
    return (
      <div className="booking-form">
        <h3>Заявка на время получена</h3>
        <p className="form-result" role="status">
          {message}
        </p>
        {telegramUrl && (
          <div className="telegram-followup">
            <a
              className="button button-wine"
              href={telegramUrl}
              target="_blank"
              rel="noreferrer"
            >
              Получить подтверждение в Telegram
            </a>
            <p>
              Откройте бота и нажмите Start. Студия подтвердит выбранное время.
              Не пересылайте ссылку другим людям.
            </p>
          </div>
        )}
        <p className="form-footnote">
          Изменить или отменить запись:{" "}
          <a href={contact.phoneHref}>{contact.phone}</a>
        </p>
        <button
          className="button button-wine"
          type="button"
          onClick={() => {
            chooseGroup("");
            setDate("");
            setTelegramUrl(null);
            setKey(crypto.randomUUID());
          }}
        >
          Ещё одна запись
        </button>
      </div>
    );
  return (
    <form
      className="booking-form"
      aria-label="Онлайн-календарь записи"
      method="post"
      action="/api/calendar/book"
      onSubmit={submit}
    >
      <div className="form-top">
        <span>Выберите свой визит</span>
        <span aria-hidden="true">
          <Arrow />
        </span>
      </div>
      <p className="calendar-hint">
        Пн–сб, 09:00–22:00 · время Минска. Запись на 60 дней вперёд, не позднее
        чем за час до визита
      </p>
      <label htmlFor="calendar-service">Услуга</label>
      <select
        id="calendar-service"
        value={group}
        onChange={(e) => chooseGroup(e.target.value)}
        required
      >
        <option value="">Выберите услугу</option>
        <optgroup label="Уход и массаж">
          {groups
            .filter((s) => s.group !== "seas")
            .map((s) => (
              <option key={s.group} value={s.group}>
                {s.name}
              </option>
            ))}
        </optgroup>
        <optgroup label="Занятия для детей">
          {groups
            .filter((s) => s.group === "seas")
            .map((s) => (
              <option key={s.group} value={s.group}>
                {s.name}
              </option>
            ))}
        </optgroup>
      </select>
      {variants.length > 1 ? (
        <>
          <label htmlFor="calendar-duration">Длительность</label>
          <select
            id="calendar-duration"
            value={variant}
            onChange={(e) => {
              setVariant(e.target.value);
              setSlot("");
            }}
          >
            {variants.map((s) => (
              <option key={s.id} value={s.id}>
                {s.duration} минут
              </option>
            ))}
          </select>
        </>
      ) : (
        selected && (
          <p className="field-hint">
            Длительность процедуры: {selected.duration} минут
          </p>
        )
      )}
      <label htmlFor="calendar-master">Мастер</label>
      <select
        id="calendar-master"
        value={master}
        onChange={(e) => {
          setMaster(e.target.value);
          setSlot("");
        }}
        required
        disabled={!selected}
      >
        <option value="">Выберите мастера</option>
        {staff
          .filter((s) => selected?.staff.some((id) => id === s.id))
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
      </select>
      <label htmlFor="calendar-date">Дата</label>
      <input
        type="date"
        id="calendar-date"
        value={date}
        min={minskDate()}
        max={maxCalendarDate()}
        required
        disabled={!master}
        onChange={(e) => {
          setDate(e.target.value);
          setSlot("");
        }}
      />
      <fieldset className="slot-fieldset">
        <legend>Свободное время</legend>
        {loading ? (
          <p role="status">Ищем свободное время…</p>
        ) : loadError ? (
          <p role="alert">{loadError}</p>
        ) : !date ? (
          <p>Сначала выберите услугу, мастера и дату</p>
        ) : slots.length === 0 ? (
          <p>
            На эту дату нет свободного времени. Выберите другой день или мастера
          </p>
        ) : (
          <div className="slot-grid">
            {slots.map((s) => (
              <label
                className={
                  s === slot ? "slot-option is-selected" : "slot-option"
                }
                key={s}
              >
                <input
                  type="radio"
                  name="startsAt"
                  value={s}
                  required
                  checked={slot === s}
                  onChange={() => {
                    setSlot(s);
                    setKey(crypto.randomUUID());
                  }}
                />
                <span>{timeLabel(s)}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <div className="form-pair">
        <div>
          <label htmlFor="calendar-name">Ваше имя</label>
          <input
            id="calendar-name"
            name="name"
            required
            maxLength={100}
            autoComplete="given-name"
          />
        </div>
        <div>
          <label htmlFor="calendar-phone">Телефон</label>
          <input
            id="calendar-phone"
            name="phone"
            type="tel"
            required
            pattern="[+0-9() \-]{7,30}"
            maxLength={30}
            autoComplete="tel"
            placeholder="+375…"
          />
        </div>
      </div>
      <label htmlFor="calendar-comment">Пожелания (необязательно)</label>
      <textarea
        id="calendar-comment"
        name="comment"
        rows={2}
        maxLength={1000}
      />
      <div className="honey" aria-hidden="true">
        <label htmlFor="calendar-website">Ваш сайт</label>
        <input
          id="calendar-website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>
      <label className="consent">
        <input type="checkbox" name="consent" required />
        <span>
          Согласна / согласен на обработку данных согласно{" "}
          <a href="/privacy" target="_blank" rel="noreferrer">
            политике конфиденциальности
          </a>
          . За ребёнка заявку оставляет родитель или законный представитель.
        </span>
      </label>
      <button
        className="button button-wine form-submit"
        disabled={!ready || !slot || loading || status === "sending"}
      >
        {status === "sending" ? "Сохраняем…" : "Записаться на выбранное время"}
      </button>
      <p
        role="status"
        className={status === "error" ? "form-result error" : "form-result"}
      >
        {message}
      </p>
      <p className="form-footnote">
        После каждой процедуры предусмотрено 15 минут подготовки. Запись
        подтвердит студия. Для связи:{" "}
        <a href={contact.phoneHref}>{contact.phone}</a>
      </p>
    </form>
  );
}
