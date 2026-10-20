import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { intakeReady, services, siteUrl } from "@/lib/studio";
export const runtime = "nodejs";
const attempts = new Map<string, { count: number; until: number }>();
const reply = (error: string, status: number) =>
  NextResponse.json({ error }, { status });
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const allowed = [request.nextUrl.origin, siteUrl()].filter(Boolean);
  if (
    (origin && !allowed.includes(origin)) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return reply("Отправьте заявку с сайта студии", 403);
  if (!request.headers.get("content-type")?.includes("application/json"))
    return reply("Неверный формат заявки", 415);
  if (Number(request.headers.get("content-length") || 0) > 16000)
    return reply("Слишком большой объём данных", 413);
  let raw = "";
  try {
    const reader = request.body?.getReader();
    if (!reader) return reply("Пустая заявка", 400);
    const parts: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16000) {
        await reader.cancel();
        return reply("Слишком большой объём данных", 413);
      }
      parts.push(value);
    }
    raw = Buffer.concat(parts).toString("utf8");
  } catch {
    return reply("Не удалось прочитать заявку", 400);
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error();
  } catch {
    return reply("Проверьте данные заявки", 400);
  }
  const text = (key: string) =>
    typeof body[key] === "string" ? (body[key] as string).trim() : "";
  if (text("website")) return NextResponse.json({ ok: true });
  const name = text("name"),
    phone = text("phone"),
    service = text("service"),
    message = text("comment"),
    page = text("page");
  const digits = phone.replace(/\D/g, "");
  if (name.length < 1 || name.length > 100)
    return reply("Укажите имя до 100 символов", 400);
  if (
    !/^[+\d()\s-]{7,30}$/.test(phone) ||
    digits.length < 7 ||
    digits.length > 15
  )
    return reply("Проверьте телефон и укажите код страны", 400);
  const selected = services.find((s) => s.id === service);
  if (!selected) return reply("Выберите услугу из списка", 400);
  if (message.length > 1000 || page.length > 2000)
    return reply("Сократите комментарий до 1000 символов", 400);
  if (body.consent !== true)
    return reply("Нужно согласие на обработку персональных данных", 400);
  if (!intakeReady())
    return reply("Онлайн-запись пока не открыта. Заявка не отправлена", 503);
  const now = Date.now();
  for (const [key, value] of attempts)
    if (value.until <= now) attempts.delete(key);
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const counter = attempts.get(ip);
  if (counter && counter.count >= 5)
    return reply("Слишком много заявок. Попробуйте через 10 минут", 429);
  if (!counter && attempts.size >= 10000)
    return reply("Сервис временно занят. Попробуйте позднее", 503);
  attempts.set(ip, {
    count: (counter?.count || 0) + 1,
    until: counter?.until || now + 600000,
  });
  const utm: Record<string, string> = {};
  if (body.utm && typeof body.utm === "object" && !Array.isArray(body.utm))
    for (const [key, value] of Object.entries(body.utm))
      if (
        /^utm_(source|medium|campaign|term|content)$/.test(key) &&
        typeof value === "string"
      )
        utm[key] = value.slice(0, 200);
  const database = async () => {
    try {
      const client = createClient(
        process.env.SUPABASE_URL!.trim(),
        process.env.SUPABASE_SECRET_KEY!.trim(),
        {
          auth: { persistSession: false, autoRefreshToken: false },
          global: {
            fetch: (input, init) =>
              fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
          },
        },
      );
      const { error, status } = await client.from("leads").insert({
        name,
        phone,
        service: selected.name,
        message,
        page,
        utm,
        consent: true,
      });
      if (error) {
        const code = /^[A-Z0-9_]{1,20}$/.test(error.code || "")
          ? error.code
          : "DATABASE_ERROR";
        console.error(
          `SAVA_DELIVERY channel=database code=${code} status=${status}`,
        );
      } else {
        console.info("SAVA_DELIVERY channel=database code=DELIVERED");
      }
      return !error;
    } catch {
      console.error(
        "SAVA_DELIVERY channel=database code=CONNECTION_OR_CONFIG_ERROR",
      );
      return false;
    }
  };
  const telegram = async () => {
    try {
      const timestamp = new Intl.DateTimeFormat("ru-BY", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Minsk",
      }).format(new Date());
      const result = await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN!.trim()}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID!.trim(),
            text: `Новая заявка SAVA\n${selected.name}\nИмя: ${name}\nТелефон: ${phone}\nПожелания: ${message || "—"}\nСтраница: ${page || "—"}\nUTM: ${JSON.stringify(utm)}\nСогласие: получено\n${timestamp} (Минск)`,
          }),
          signal: AbortSignal.timeout(10000),
        },
      );
      const data = await result.json();
      if (!result.ok || data.ok !== true) {
        const description =
          typeof data.description === "string"
            ? data.description.toLowerCase()
            : "";
        const code =
          result.status === 401 || result.status === 404
            ? "INVALID_TOKEN"
            : description.includes("chat not found")
              ? "CHAT_NOT_FOUND"
              : description.includes("blocked")
                ? "BOT_BLOCKED"
                : description.includes("can't initiate")
                  ? "START_REQUIRED"
                  : result.status === 429
                    ? "RATE_LIMITED"
                    : "TELEGRAM_REJECTED";
        console.error(
          `SAVA_DELIVERY channel=telegram code=${code} status=${result.status}`,
        );
        return false;
      }
      console.info("SAVA_DELIVERY channel=telegram code=DELIVERED");
      return true;
    } catch {
      console.error(
        "SAVA_DELIVERY channel=telegram code=CONNECTION_OR_RESPONSE_ERROR",
      );
      return false;
    }
  };
  const [saved, notified] = await Promise.all([database(), telegram()]);
  if (!saved) console.error("Lead database delivery failed");
  if (!notified) console.error("Lead notification delivery failed");
  if (!saved && !notified)
    return reply("Не удалось отправить заявку. Попробуйте позднее", 502);
  return NextResponse.json({ ok: true });
}
