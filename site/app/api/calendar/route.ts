import { NextRequest, NextResponse } from "next/server";
import {
  calendarEnabled,
  calendarServices,
  staff,
  validDate,
} from "@/lib/calendar";
import { bookingDb } from "@/lib/telegram-booking";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  if (!calendarEnabled())
    return NextResponse.json({ enabled: false }, { headers });
  const q = request.nextUrl.searchParams;
  if (!q.has("date"))
    return NextResponse.json(
      {
        enabled: true,
        services: calendarServices,
        staff,
        timeZone: "Europe/Minsk",
        bufferMinutes: 15,
        horizonDays: 60,
      },
      { headers },
    );
  const date = q.get("date") || "",
    service = q.get("service") || "",
    master = q.get("staff") || "";
  if (
    !validDate(date) ||
    !calendarServices.some(
      (s) => s.id === service && s.staff.some((x) => x === master),
    )
  )
    return NextResponse.json(
      {
        error: "Выберите доступную услугу, мастера и дату в ближайшие 60 дней",
      },
      { status: 400, headers },
    );
  try {
    const { data, error } = await bookingDb().rpc("calendar_availability", {
      p_staff: master,
      p_service: service,
      p_date: date,
    });
    if (error) throw Error();
    return NextResponse.json(
      {
        slots: (data || []).map((s: { starts_at: string }) =>
          new Date(s.starts_at).toISOString(),
        ),
      },
      { headers },
    );
  } catch {
    console.error("SAVA_CALENDAR code=AVAILABILITY_FAILED");
    return NextResponse.json(
      { error: "Календарь временно недоступен. Позвоните +375 (44) 575-24-92" },
      { status: 503, headers },
    );
  }
}
