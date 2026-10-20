import { NextResponse } from "next/server";
import {
  authorizedSecret,
  bookingDb,
  botCall,
  confirmationsReady,
  readLimitedJson,
  TelegramFailure,
} from "@/lib/telegram-booking";
import { siteUrl } from "@/lib/studio";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Public readiness metadata only: never return a secret, digest, token or chat ID.
export async function GET() {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || "";
  return NextResponse.json(
    {
      secretConfigured: Boolean(secret),
      secretFormatValid: /^[A-Za-z0-9_-]{32,256}$/.test(secret),
      confirmationsEnabled:
        process.env.TELEGRAM_CONFIRMATIONS_ENABLED?.trim() === "true",
      siteUrlConfigured: Boolean(siteUrl()?.startsWith("https://")),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin && origin !== siteUrl())
    return NextResponse.json(
      { error: "Недопустимый источник запроса" },
      { status: 403 },
    );
  if (!request.headers.get("content-type")?.includes("application/json"))
    return NextResponse.json(
      { error: "Неверный формат запроса" },
      { status: 415 },
    );
  let body;
  try {
    body = await readLimitedJson(request, 2048);
  } catch {
    return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });
  }
  const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || "";
  if (!configuredSecret)
    return NextResponse.json(
      {
        error:
          "В опубликованной версии Netlify отсутствует TELEGRAM_WEBHOOK_SECRET. Заполните Production, включите Functions и запустите новую публикацию.",
      },
      { status: 503 },
    );
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(configuredSecret))
    return NextResponse.json(
      {
        error:
          "Секрет в Netlify имеет неверный формат. Нужны 32–256 латинских букв, цифр, символов _ или -.",
      },
      { status: 503 },
    );
  if (
    !body ||
    typeof body !== "object" ||
    !("secret" in body) ||
    typeof body.secret !== "string" ||
    !authorizedSecret(body.secret.trim())
  )
    return NextResponse.json(
      { error: "Секрет не совпадает с TELEGRAM_WEBHOOK_SECRET в Netlify" },
      { status: 403 },
    );
  if (
    !confirmationsReady() ||
    !/^\d+$/.test(process.env.TELEGRAM_CHAT_ID?.trim() || "")
  )
    return NextResponse.json(
      {
        error:
          "Проверьте TELEGRAM_CONFIRMATIONS_ENABLED=true, SITE_URL и личный TELEGRAM_CHAT_ID владельца",
      },
      { status: 503 },
    );
  const url = siteUrl();
  if (!url?.startsWith("https://"))
    return NextResponse.json(
      { error: "SITE_URL должен быть полным HTTPS-адресом сайта" },
      { status: 503 },
    );
  try {
    const { error } = await bookingDb()
      .from("telegram_bookings")
      .select("id")
      .limit(0);
    if (error)
      return NextResponse.json(
        {
          error:
            "Сначала выполните файл supabase/telegram-confirmations.sql в SQL Editor вашего проекта Supabase",
        },
        { status: 503 },
      );
    const me = await botCall("getMe");
    if (typeof me.username !== "string") throw Error();
    await botCall("setWebhook", {
      url: `${url}/api/telegram/webhook`,
      secret_token: process.env.TELEGRAM_WEBHOOK_SECRET!.trim(),
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
      max_connections: 1,
    });
    const info = await botCall("getWebhookInfo");
    if (info.url !== `${url}/api/telegram/webhook`) throw Error();
    return NextResponse.json({
      ok: true,
      botUsername: me.username,
      message:
        "Бот подключён. Теперь отправьте новую заявку и проверьте весь путь клиента.",
    });
  } catch (e) {
    console.error(
      `SAVA_SETUP code=${e instanceof TelegramFailure ? e.code : "SETUP_FAILED"}`,
    );
    return NextResponse.json(
      {
        error:
          "Не удалось подключить бота. Проверьте серверный журнал SAVA_SETUP",
      },
      { status: 502 },
    );
  }
}
