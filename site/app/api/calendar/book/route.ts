import { createHmac, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  calendarEnabled,
  calendarError,
  calendarInput,
  staff,
} from "@/lib/calendar";
import {
  bookingDb,
  botCall,
  confirmationsReady,
  formatAppointment,
  hashLink,
  readLimitedJson,
  sendText,
} from "@/lib/telegram-booking";
import { calendarKeyboard } from "@/lib/calendar-server";
import { intakeReady, siteUrl } from "@/lib/studio";
export const runtime = "nodejs";
const attempts = new Map<string, { count: number; expires: number }>();
const reply = (error: string, status: number) =>
  NextResponse.json({ error }, { status });
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (
    (origin && ![request.nextUrl.origin, siteUrl()].includes(origin)) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return reply("Откройте форму на сайте студии", 403);
  if (!calendarEnabled() || !intakeReady() || !confirmationsReady())
    return reply(
      "Календарь ещё настраивается. Позвоните в студию для записи",
      503,
    );
  if (!request.headers.get("content-type")?.includes("application/json"))
    return reply("Неверный формат заявки", 415);
  let body: Record<string, unknown>;
  try {
    const value = await readLimitedJson(request, 16000);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error();
    body = value as Record<string, unknown>;
  } catch {
    return reply("Неверные данные заявки", 400);
  }
  const text = (k: string) =>
    typeof body[k] === "string" ? (body[k] as string).trim() : "";
  if (text("website")) return NextResponse.json({ ok: true });
  const name = text("name"),
    phone = text("phone"),
    comment = text("comment"),
    page = text("page"),
    master = text("staff"),
    service = text("service"),
    startsAt = text("startsAt"),
    requestKey = text("requestKey");
  const selected = calendarInput(service, master, startsAt);
  if (!selected)
    return reply("Выберите доступные услугу, мастера и будущее время", 400);
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      requestKey,
    )
  )
    return reply("Обновите страницу и повторите выбор времени", 400);
  if (
    !name ||
    name.length > 100 ||
    !/^\+?[0-9()\s-]{7,30}$/.test(phone) ||
    phone.replace(/\D/g, "").length < 7 ||
    phone.replace(/\D/g, "").length > 15 ||
    comment.length > 1000 ||
    page.length > 2000
  )
    return reply("Проверьте имя, телефон и длину комментария", 400);
  if (body.consent !== true)
    return reply("Нужно согласие на обработку данных", 400);
  const now = Date.now();
  for (const [k, v] of attempts) if (v.expires <= now) attempts.delete(k);
  const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local",
    counter = attempts.get(ip);
  if (counter && counter.count >= 5)
    return reply("Слишком много попыток. Попробуйте через 10 минут", 429);
  if (!counter && attempts.size >= 10000)
    return reply("Сервис временно занят", 503);
  attempts.set(ip, {
    count: (counter?.count || 0) + 1,
    expires: counter?.expires || now + 600000,
  });
  const utm: Record<string, string> = {};
  if (body.utm && typeof body.utm === "object")
    for (const [k, v] of Object.entries(body.utm))
      if (
        /^utm_(source|medium|campaign|term|content)$/.test(k) &&
        typeof v === "string"
      )
        utm[k] = v.slice(0, 200);
  const db = bookingDb();
  let leadId: string;
  let replay = false;
  try {
    const { data, error } = await db.rpc("calendar_reserve", {
      p_request_key: requestKey,
      p_service: service,
      p_staff: master,
      p_start: startsAt,
      p_name: name,
      p_phone: phone,
      p_message: comment,
      p_page: page,
      p_utm: utm,
    });
    if (error) {
      console.error(
        `SAVA_CALENDAR code=${error.code === "23P01" ? "SLOT_CONFLICT" : "RESERVE_FAILED"}`,
      );
      return reply(
        calendarError(error.code),
        error.code === "23P01" ? 409 : error.code === "22023" ? 400 : 503,
      );
    }
    if (!data?.lead_id) throw Error();
    leadId = data.lead_id;
    replay = data.already_existed === true;
  } catch {
    return reply(
      "Не удалось проверить запись. Повторите отправку с тем же выбранным временем",
      503,
    );
  }
  let telegramUrl: string | null = null;
  let nonce: string | null = null;
  try {
    const me = await botCall("getMe");
    if (!/^[A-Za-z0-9_]{5,32}$/.test(me.username || "")) throw Error();
    const token = createHmac(
      "sha256",
      process.env.TELEGRAM_WEBHOOK_SECRET!.trim(),
    )
      .update(`calendar:${leadId}`)
      .digest("base64url");
    const candidate = randomBytes(8).toString("hex");
    const { error } = await db
      .from("telegram_bookings")
      .upsert(
        {
          id: leadId,
          token_hash: hashLink(token),
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          service: `${selected.name} — ${selected.duration} мин, ${staff.find((s) => s.id === master)!.name}`,
          appointment_at: startsAt,
          preview_nonce: candidate,
        },
        { onConflict: "id", ignoreDuplicates: true },
      );
    if (error) throw Error();
    const { data, error: readError } = await db
      .from("telegram_bookings")
      .select("preview_nonce,token_hash")
      .eq("id", leadId)
      .single();
    if (readError) throw Error();
    nonce = data.preview_nonce;
    if (data.token_hash === hashLink(token))
      telegramUrl = `https://t.me/${me.username}?start=${token}`;
  } catch {
    console.error("SAVA_CALENDAR code=TELEGRAM_LINK_FAILED");
  }
  if (!replay) {
    try {
      await sendText(
        process.env.TELEGRAM_CHAT_ID!.trim(),
        `Новая запись из календаря SAVA\n${selected.name} — ${selected.duration} мин\nМастер: ${staff.find((s) => s.id === master)!.name}\nКогда: ${formatAppointment(startsAt)} (Минск)\nИмя: ${name}\nТелефон: ${phone}\nПожелания: ${comment || "—"}\nЗаявка: ${leadId.slice(0, 8)}\nВремя удерживается до вашего решения.`,
        nonce ? { reply_markup: calendarKeyboard(leadId, nonce) } : {},
      );
      console.info("SAVA_CALENDAR code=OWNER_NOTIFIED");
    } catch {
      console.error("SAVA_CALENDAR code=OWNER_NOTIFICATION_FAILED");
    }
  }
  return NextResponse.json({
    ok: true,
    appointment: {
      startsAt,
      duration: selected.duration,
      master: staff.find((s) => s.id === master)!.name,
      service: selected.name,
    },
    ...(telegramUrl ? { telegramUrl } : {}),
  });
}
