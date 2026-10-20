"use client";
import { Arrow } from "@/components/Icons";

import { useEffect, useState } from "react";
import { contact, services } from "@/lib/studio";
export default function Booking({ ready }: { ready: boolean }) {
  const [service, setService] = useState("");
  const [status, setStatus] = useState<
    "idle" | "sending" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  useEffect(() => {
    const handler = (event: Event) => {
      setService((event as CustomEvent<string>).detail);
      setStatus("idle");
    };
    window.addEventListener("sava:service", handler);
    return () => window.removeEventListener("sava:service", handler);
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || status === "sending") return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setStatus("sending");
    setMessage("");
    try {
      const utm = Object.fromEntries(
        [...new URLSearchParams(window.location.search)].filter(([k]) =>
          /^utm_(source|medium|campaign|term|content)$/.test(k),
        ),
      );
      const result = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          phone: data.get("phone"),
          service,
          comment: data.get("comment"),
          consent: data.get("consent") === "on",
          website: data.get("website"),
          page: window.location.origin + window.location.pathname,
          utm,
        }),
      });
      const response = await result.json();
      if (!result.ok)
        throw new Error(
          response.error || "Не удалось отправить заявку. Попробуйте позднее.",
        );
      setStatus("success");
      form.reset();
      setService("");
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось отправить заявку. Попробуйте позднее.",
      );
    }
  }
  return (
    <form
      onSubmit={submit}
      className="booking-form"
      aria-label="Заявка на запись"
    >
      <div className="form-top">
        <span className="small-label">Ваш следующий визит</span>
        <span aria-hidden="true">
          <Arrow />
        </span>
      </div>
      {!ready && (
        <p className="intake-notice" role="status">
          Онлайн-запись скоро откроется. Пока заявки через эту форму не
          отправляются
        </p>
      )}
      {!ready && (
        <p className="booking-call">
          Записаться по телефону:{" "}
          <a href={contact.phoneHref}>{contact.phone}</a>
        </p>
      )}
      <label htmlFor="service">Выберите услугу</label>
      <select
        id="service"
        name="service"
        required
        value={service}
        onChange={(e) => setService(e.target.value)}
      >
        <option value="" disabled>
          Что подарим себе сегодня?
        </option>
        {services.map((s) => (
          <option value={s.id} key={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <div className="form-pair">
        <div>
          <label htmlFor="name">Ваше имя</label>
          <input
            name="name"
            id="name"
            placeholder="Как к вам обращаться?"
            autoComplete="given-name"
            required
            minLength={1}
            maxLength={100}
          />
        </div>
        <div>
          <label htmlFor="phone">Телефон</label>
          <input
            id="phone"
            name="phone"
            placeholder="+375 (__) ___-__-__"
            autoComplete="tel"
            type="tel"
            required
            maxLength={30}
            pattern="[+0-9() \-]{7,30}"
            aria-describedby="phone-hint"
          />
          <span id="phone-hint" className="field-hint">
            Номер с кодом страны
          </span>
        </div>
      </div>
      <label htmlFor="comment">
        Пожелания <span className="optional">необязательно</span>
      </label>
      <textarea
        id="comment"
        name="comment"
        placeholder="Удобное время, покрытие или вопрос об услуге"
        maxLength={1000}
        rows={2}
      />
      <div className="honey" aria-hidden="true">
        <label htmlFor="website">Ваш сайт</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <label className="consent">
        <input type="checkbox" name="consent" required />
        <span>
          Согласна / согласен на обработку персональных данных согласно{" "}
          <a href="/privacy" target="_blank" rel="noreferrer">
            политике конфиденциальности
          </a>
        </span>
      </label>
      <button
        className="button button-wine form-submit"
        type="submit"
        disabled={!ready || status === "sending" || status === "success"}
      >
        {status === "sending"
          ? "Отправляем…"
          : status === "success"
            ? "Заявка отправлена"
            : ready
              ? "Оставить заявку"
              : "Запись скоро откроется"}
        <span aria-hidden="true">
          <Arrow />
        </span>
      </button>
      <p
        role="status"
        aria-live="polite"
        className={status === "error" ? "form-result error" : "form-result"}
      >
        {status === "success"
          ? "Спасибо! Заявка получена. Студия свяжется с вами для согласования визита. Время пока не забронировано."
          : message}
      </p>
      <p className="form-footnote">
        Заявка — первый шаг. Дату, время и стоимость согласуем лично
      </p>
    </form>
  );
}
