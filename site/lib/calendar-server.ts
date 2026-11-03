import { bookingDb } from "./telegram-booking";
export async function calendarAppointment(leadId: string) {
  const { data, error } = await bookingDb()
    .from("calendar_appointments")
    .select("lead_id,staff_id,service_id,state,starts_at")
    .eq("lead_id", leadId)
    .maybeSingle();
  if (error && ["PGRST205", "42P01"].includes(error.code)) return null;
  if (error) throw Error("CALENDAR_READ_FAILED");
  return data;
}
export function calendarKeyboard(id: string, nonce: string) {
  return {
    inline_keyboard: [
      [
        {
          text: "Подтвердить выбранное время",
          callback_data: `confirm:${id}:${nonce}`,
        },
      ],
      [
        { text: "Изменить время", callback_data: `schedule:${id}` },
        { text: "Отменить запись", callback_data: `cancel:${id}` },
      ],
    ],
  };
}
export async function cancelCalendar(leadId: string) {
  const db = bookingDb();
  const { data: changed, error } = await db.rpc("calendar_cancel", {
    p_lead: leadId,
  });
  if (error) throw Error("CALENDAR_CANCEL_FAILED");
  if (!changed) return { changed: false, notified: false };
  const { data } = await db
    .from("telegram_bookings")
    .select("client_chat_id")
    .eq("id", leadId)
    .maybeSingle();
  let notified = false;
  if (data?.client_chat_id) {
    try {
      const { sendText } = await import("./telegram-booking");
      await sendText(
        data.client_chat_id,
        "Запись в SAVA отменена студией. Для выбора другого времени откройте сайт или позвоните +375 (44) 575-24-92",
      );
      notified = true;
    } catch {
      console.error("SAVA_CALENDAR code=CANCEL_NOTIFICATION_FAILED");
    }
  }
  return { changed: true, notified };
}
