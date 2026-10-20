"use client";
import { useState } from "react";
export default function TelegramSetup() {
  const [secret, setSecret] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  function generate() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    setSecret(
      Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""),
    );
    setMessage(
      "Сохраните секрет у себя и в переменной Netlify TELEGRAM_WEBHOOK_SECRET. В чат его не присылайте.",
    );
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("Подключаем…");
    try {
      const res = await fetch("/api/telegram/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      const body = await res.json();
      setMessage(
        res.ok
          ? `${body.message} Бот: @${body.botUsername}`
          : body.error || "Ошибка подключения",
      );
    } catch {
      setMessage("Не удалось связаться с сервером. Попробуйте позднее.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p>
        Эта страница предназначена владельцу студии. Существующие уведомления о
        заявках продолжат работать без включения новой функции.
      </p>
      <ol>
        <li>
          В Supabase → SQL Editor выполните{" "}
          <a
            href="https://github.com/Julia140794/sava/blob/main/supabase/telegram-confirmations.sql"
            target="_blank"
            rel="noreferrer"
          >
            дополнительный SQL-файл
          </a>
          . Он добавляет таблицу подтверждений и сохраняет ваши заявки.
        </li>
        <li>
          Создайте секрет кнопкой ниже. Сохраните его у себя и в Netlify →
          Environment variables как <code>TELEGRAM_WEBHOOK_SECRET</code>. Для
          новой переменной нужны Builds и Functions, production-контекст.
        </li>
        <li>
          Там же добавьте <code>TELEGRAM_CONFIRMATIONS_ENABLED</code> со
          значением <code>true</code>, для Builds и Functions.{" "}
          <code>SITE_URL</code> должен содержать полный адрес сайта.
        </li>
        <li>
          Запустите новую публикацию в Netlify, дождитесь Published. Вернитесь
          сюда, вставьте сохранённый секрет и нажмите «Подключить бота».
        </li>
      </ol>
      <p>
        Это подключение рассчитано на отдельного бота студии. Если он уже
        обслуживает другой сайт или сервис, подключение заменит его обработчик
        входящих сообщений.
      </p>
      <form className="setup-form" onSubmit={submit}>
        <label htmlFor="webhook-secret">Секрет подключения</label>
        <input
          id="webhook-secret"
          type="password"
          autoComplete="off"
          minLength={32}
          maxLength={256}
          pattern="[A-Za-z0-9_-]{32,256}"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          required
        />
        <div className="setup-actions">
          <button type="button" onClick={generate}>
            Создать секрет
          </button>
          <button
            type="button"
            disabled={!secret}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(secret);
                setMessage(
                  "Секрет скопирован. Сохраните его в Netlify и у себя.",
                );
              } catch {
                setMessage(
                  "Копирование не удалось. Выделите значение в поле и скопируйте вручную.",
                );
              }
            }}
          >
            Скопировать
          </button>
          <button type="submit" disabled={busy}>
            {busy ? "Подключаем…" : "Подключить бота"}
          </button>
        </div>
        <p role="status" aria-live="polite">
          {message}
        </p>
      </form>
      <p>
        После подключения создайте тестовую заявку. Клиент нажимает кнопку
        Telegram после отправки, затем Start у бота. Владелец выбирает время в
        уведомлении и проверяет его перед подтверждением. Сообщения клиентов в
        свободной форме пока не пересылаются владельцу — для изменений записи
        используется телефон студии.
      </p>
    </>
  );
}
