import { NextResponse } from "next/server";
import {
  authorizedSecret,
  bookingDb,
  readLimitedJson,
} from "@/lib/telegram-booking";
import { minskDate, maxCalendarDate, staff } from "@/lib/calendar";
import { cancelCalendar } from "@/lib/calendar-server";
import { siteUrl } from "@/lib/studio";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && ![new URL(request.url).origin, siteUrl()].includes(origin))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!request.headers.get("content-type")?.includes("application/json"))
    return NextResponse.json({ error: "Неверный формат" }, { status: 415 });
  let body: Record<string, unknown>;
  try {
    const b = await readLimitedJson(request, 4096);
    if (!b || typeof b !== "object" || Array.isArray(b)) throw Error();
    body = b as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });
  }
  if (typeof body.secret !== "string" || !authorizedSecret(body.secret.trim()))
    return NextResponse.json(
      { error: "Секрет не совпадает с TELEGRAM_WEBHOOK_SECRET" },
      { status: 403 },
    );
  const db = bookingDb();
  try {
    if (body.action === "list") {
      const date = typeof body.date === "string" ? body.date : "";
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        date < minskDate() ||
        date > maxCalendarDate()
      )
        return NextResponse.json(
          { error: "Выберите день в ближайшие 60 дней" },
          { status: 400 },
        );
      const start = new Date(`${date}T00:00:00+03:00`),
        end = new Date(start.getTime() + 86400000);
      const { data, error } = await db
        .from("calendar_appointments")
        .select(
          "id,lead_id,kind,state,staff_id,service_id,starts_at,ends_at,leads(name,phone)",
        )
        .lt("starts_at", end.toISOString())
        .gt("busy_until", start.toISOString())
        .order("starts_at")
        .limit(300);
      if (error) throw Error();
      return NextResponse.json(
        { appointments: data },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (
      body.action === "cancel" &&
      typeof body.leadId === "string" &&
      /^[a-f0-9-]{36}$/.test(body.leadId)
    )
      return NextResponse.json({
        ok: true,
        ...(await cancelCalendar(body.leadId)),
      });
    if (
      body.action === "confirm" &&
      typeof body.leadId === "string" &&
      /^[a-f0-9-]{36}$/.test(body.leadId)
    ) {
      const { data, error } = await db
        .from("calendar_appointments")
        .update({ state: "confirmed" })
        .eq("lead_id", body.leadId)
        .neq("state", "cancelled")
        .select("id");
      if (error || !data?.length) throw Error();
      return NextResponse.json({
        ok: true,
        message:
          "Время подтверждено. Свяжитесь с клиентом по телефону или отправьте подтверждение кнопкой в Telegram.",
      });
    }
    if (
      body.action === "cancelBlock" &&
      typeof body.id === "string" &&
      /^[a-f0-9-]{36}$/.test(body.id)
    ) {
      const { data, error } = await db
        .from("calendar_appointments")
        .update({ state: "cancelled" })
        .eq("id", body.id)
        .eq("kind", "block")
        .select("id");
      if (error || !data?.length) throw Error();
      return NextResponse.json({ ok: true });
    }
    if (
      body.action === "block" &&
      typeof body.staff === "string" &&
      staff.some((s) => s.id === body.staff) &&
      typeof body.from === "string" &&
      typeof body.to === "string"
    ) {
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(body.from) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(body.to)
      )
        throw Error();
      const from = new Date(`${body.from}+03:00`),
        to = new Date(`${body.to}+03:00`);
      if (
        !Number.isFinite(from.getTime()) ||
        !Number.isFinite(to.getTime()) ||
        new Date(from.getTime() + 3 * 3600000).toISOString().slice(0, 16) !==
          body.from ||
        new Date(to.getTime() + 3 * 3600000).toISOString().slice(0, 16) !==
          body.to ||
        from >= to ||
        to.getTime() - from.getTime() > 61 * 86400000 ||
        body.from.slice(0, 10) < minskDate() ||
        body.to.slice(0, 10) > maxCalendarDate()
      )
        return NextResponse.json(
          { error: "Проверьте начало и конец закрытого времени" },
          { status: 400 },
        );
      const { error } = await db.from("calendar_appointments").insert({
        staff_id: body.staff,
        kind: "block",
        state: "confirmed",
        starts_at: from.toISOString(),
        ends_at: to.toISOString(),
        busy_until: to.toISOString(),
      });
      if (error)
        return NextResponse.json(
          {
            error:
              error.code === "23P01"
                ? "Интервал пересекается с записью или другим закрытым временем. Сначала проверьте расписание."
                : "Не удалось закрыть время",
          },
          { status: error.code === "23P01" ? 409 : 503 },
        );
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json(
      { error: "Неизвестное действие" },
      { status: 400 },
    );
  } catch {
    console.error("SAVA_CALENDAR code=MANAGEMENT_FAILED");
    return NextResponse.json(
      {
        error:
          "Не удалось выполнить действие. Проверьте миграцию календаря и состояние записи. При отправке подтверждения дождитесь её завершения.",
      },
      { status: 503 },
    );
  }
}
