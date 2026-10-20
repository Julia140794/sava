import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import {
  authorizedSecret,
  bookingDb,
  botCall,
  confirmationsReady,
  formatAppointment,
  hashLink,
  parseAppointment,
  readLimitedJson,
  scheduleKeyboard,
  sendText,
  TelegramFailure,
} from "@/lib/telegram-booking";
export const runtime = "nodejs";
type Message = {
  message_id: number;
  text?: string;
  chat: { id: number; type?: string };
  from?: { id: number; is_bot?: boolean };
  reply_to_message?: { message_id: number };
};
type Update = {
  update_id?: number;
  message?: Message;
  callback_query?: {
    id: string;
    data?: string;
    from: { id: number };
    message?: Message;
  };
};
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
function ownerMessage(message: Message) {
  const owner = process.env.TELEGRAM_CHAT_ID?.trim();
  return (
    !!owner &&
    String(message.chat.id) === owner &&
    String(message.from?.id) === owner &&
    message.chat.type === "private"
  );
}
function failDb(error: unknown) {
  if (error) throw Error("DATABASE_OPERATION_FAILED");
}
async function handle(update: Update) {
  const db = bookingDb(),
    owner = process.env.TELEGRAM_CHAT_ID!.trim();
  async function clientLabel(id: string) {
    const { data, error } = await db
      .from("leads")
      .select("name,phone")
      .eq("id", id)
      .single();
    failDb(error);
    if (!data) throw Error("MISSING_LEAD");
    return `Клиент: ${data.name}\nТелефон: ${data.phone}`;
  }
  const m = update.message;
  if (
    m &&
    m.chat.type === "private" &&
    !m.from?.is_bot &&
    m.from?.id === m.chat.id
  ) {
    if (/^\/stop(?:@[A-Za-z0-9_]+)?$/.test(m.text || "")) {
      const { error } = await db
        .from("telegram_bookings")
        .update({
          client_chat_id: null,
          preview_nonce: null,
          owner_prompt_id: null,
        })
        .eq("client_chat_id", String(m.chat.id));
      failDb(error);
      await sendText(
        String(m.chat.id),
        "Подтверждения в Telegram отключены. Для согласования или изменения записи позвоните в SAVA: +375 (44) 575-24-92",
      );
      return;
    }
    const start =
      /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([A-Za-z0-9_-]{43}))?$/.exec(
        m.text || "",
      );
    if (start) {
      if (!start[1]) {
        await sendText(
          String(m.chat.id),
          "SAVA est.2026. Чтобы получать подтверждение записи, оставьте заявку на сайте и откройте кнопку «Получить подтверждение в Telegram» после отправки.",
        );
        return;
      }
      const hash = hashLink(start[1]);
      // Atomic first claim: another Telegram account cannot replace the recipient.
      const { data: claimed, error } = await db
        .from("telegram_bookings")
        .update({ client_chat_id: String(m.chat.id) })
        .eq("token_hash", hash)
        .is("client_chat_id", null)
        .gt("expires_at", new Date().toISOString())
        .select("id,service,owner_notified_at,delivery_status,appointment_at");
      failDb(error);
      let booking = claimed?.[0];
      if (!booking) {
        const { data, error } = await db
          .from("telegram_bookings")
          .select("id,service,owner_notified_at,delivery_status,appointment_at")
          .eq("token_hash", hash)
          .eq("client_chat_id", String(m.chat.id))
          .maybeSingle();
        failDb(error);
        booking = data || undefined;
      }
      if (!booking) {
        await sendText(
          String(m.chat.id),
          "Эта ссылка недействительна, уже использована другим аккаунтом или срок её действия истёк. Позвоните в SAVA: +375 (44) 575-24-92",
        );
        return;
      }
      // Record successful owner notification; repeated Start must not spam the owner.
      if (!booking.owner_notified_at) {
        await sendText(
          owner,
          `Клиент подключил Telegram к заявке\n${await clientLabel(booking.id)}\nУслуга: ${booking.service}\nЗаявка: ${booking.id.slice(0, 8)}\nТеперь можно согласовать и подтвердить время.`,
          { reply_markup: scheduleKeyboard(booking.id) },
        );
        const { error } = await db
          .from("telegram_bookings")
          .update({ owner_notified_at: new Date().toISOString() })
          .eq("id", booking.id);
        failDb(error);
      }
      await sendText(
        String(m.chat.id),
        booking.delivery_status === "delivered" && booking.appointment_at
          ? `Запись SAVA уже подтверждена: ${booking.service}, ${formatAppointment(booking.appointment_at)} (Минск). Для переноса или отмены позвоните +375 (44) 575-24-92. Отключить уведомления: /stop`
          : `Telegram подключён к вашей заявке SAVA: ${booking.service}. Это ещё не подтверждение времени. Как только студия согласует запись, сообщение придёт сюда. Чтобы отключить подтверждения, отправьте /stop.`,
      );
      return;
    }
  }
  const callback = update.callback_query;
  if (callback) {
    if (
      !callback.message ||
      !ownerMessage({ ...callback.message, from: callback.from })
    ) {
      await botCall("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Действие доступно только владельцу студии.",
      });
      return;
    }
    const schedule = new RegExp(`^schedule:(${uuid})$`).exec(
      callback.data || "",
    );
    const confirm = new RegExp(`^confirm:(${uuid}):([a-f0-9]{16})$`).exec(
      callback.data || "",
    );
    if (!schedule && !confirm) {
      await botCall("answerCallbackQuery", { callback_query_id: callback.id });
      return;
    }
    await botCall("answerCallbackQuery", { callback_query_id: callback.id });
    const id = (schedule || confirm)![1];
    const { data: booking, error } = await db
      .from("telegram_bookings")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    failDb(error);
    if (!booking) {
      await sendText(
        owner,
        "Заявка не найдена. Уточните запись с клиентом по телефону.",
      );
      return;
    }
    if (!booking.client_chat_id) {
      await sendText(
        owner,
        "Клиент ещё не подключил Telegram. Попросите его нажать кнопку после заявки и затем Start у бота.",
      );
      return;
    }
    if (booking.delivery_status !== "pending") {
      await sendText(
        owner,
        booking.delivery_status === "delivered"
          ? "Подтверждение уже отправлено клиенту."
          : "Отправка уже начата или её результат не определён. Не отправляйте повторно: проверьте связь с клиентом.",
      );
      return;
    }
    if (schedule) {
      const prompt = await sendText(
        owner,
        `Услуга: ${booking.service}\n${await clientLabel(booking.id)}\nОтветьте на это сообщение датой и временем по Минску:\nДД.ММ.ГГГГ ЧЧ:ММ\nНапример: 25.10.2026 14:30\nПосле этого бот покажет подтверждение для проверки.`,
        {
          reply_markup: {
            force_reply: true,
            selective: true,
            input_field_placeholder: "ДД.ММ.ГГГГ ЧЧ:ММ",
          },
        },
      );
      const { error } = await db
        .from("telegram_bookings")
        .update({
          owner_prompt_id: prompt.message_id,
          prompt_expires_at: new Date(Date.now() + 3600000).toISOString(),
        })
        .eq("id", id)
        .eq("delivery_status", "pending");
      failDb(error);
      return;
    }
    // Claim one delivery. The nonce invalidates all older date previews.
    const { data: rows, error: claimError } = await db
      .from("telegram_bookings")
      .update({ delivery_status: "sending" })
      .eq("id", id)
      .eq("delivery_status", "pending")
      .eq("preview_nonce", confirm![2])
      .not("appointment_at", "is", null)
      .select("*");
    failDb(claimError);
    const claimed = rows?.[0];
    if (!claimed) {
      await sendText(
        owner,
        "Этот вариант времени уже заменён или подтверждение отправляется. Откройте последнее сообщение с датой.",
      );
      return;
    }
    let sent;
    try {
      sent = await sendText(
        claimed.client_chat_id,
        `Ваша запись в SAVA est.2026 подтверждена!\nУслуга: ${claimed.service}\nКогда: ${formatAppointment(claimed.appointment_at)} (Минск)\nАдрес: Минск, ул. Франциска Скорины, 2\nОриентир: ст. м. Восток\nЕсли планы изменились, позвоните: +375 (44) 575-24-92`,
      );
    } catch (e) {
      const uncertain = !(e instanceof TelegramFailure) || e.uncertain;
      const { error } = await db
        .from("telegram_bookings")
        .update({ delivery_status: uncertain ? "uncertain" : "pending" })
        .eq("id", id)
        .eq("delivery_status", "sending");
      failDb(error);
      console.error(
        `SAVA_CONFIRMATION code=${e instanceof TelegramFailure ? e.code : "DELIVERY_ERROR"}`,
      );
      await sendText(
        owner,
        uncertain
          ? "Не удалось определить результат отправки. Не повторяйте подтверждение: свяжитесь с клиентом по телефону."
          : "Telegram отклонил сообщение. Попросите клиента открыть бота и нажать Start. После этого можно повторить кнопку подтверждения.",
      );
      return;
    }
    const { error: saveError } = await db
      .from("telegram_bookings")
      .update({
        delivery_status: "delivered",
        confirmed_at: new Date().toISOString(),
        telegram_message_id: sent.message_id,
      })
      .eq("id", id)
      .eq("delivery_status", "sending");
    failDb(saveError);
    await sendText(
      owner,
      `Подтверждение отправлено клиенту.\n${claimed.service}\n${formatAppointment(claimed.appointment_at)} (Минск)`,
    );
    return;
  }
  if (m && ownerMessage(m) && m.reply_to_message && m.text) {
    const { data: booking, error } = await db
      .from("telegram_bookings")
      .select("id,service,owner_notified_at,delivery_status,appointment_at")
      .eq("owner_prompt_id", m.reply_to_message.message_id)
      .eq("delivery_status", "pending")
      .gt("prompt_expires_at", new Date().toISOString())
      .maybeSingle();
    failDb(error);
    if (!booking) {
      await sendText(
        owner,
        "Этот запрос времени истёк или запись уже подтверждена. Используйте кнопку под нужной заявкой.",
      );
      return;
    }
    const appointment = parseAppointment(m.text);
    if (!appointment) {
      await sendText(
        owner,
        "Укажите будущую дату и время по Минску строго в формате ДД.ММ.ГГГГ ЧЧ:ММ, ответом на сообщение с запросом времени.",
      );
      return;
    }
    const nonce = randomBytes(8).toString("hex");
    const { data: rows, error: saveError } = await db
      .from("telegram_bookings")
      .update({ appointment_at: appointment, preview_nonce: nonce })
      .eq("id", booking.id)
      .eq("delivery_status", "pending")
      .select("id");
    failDb(saveError);
    if (!rows?.length) return;
    await sendText(
      owner,
      `Проверьте запись перед отправкой:\n${await clientLabel(booking.id)}\n${booking.service}\n${formatAppointment(appointment)} (Минск)\nАдрес: ул. Франциска Скорины, 2\nОтправить клиенту?`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Подтвердить и отправить клиенту",
                callback_data: `confirm:${booking.id}:${nonce}`,
              },
            ],
            [
              {
                text: "Изменить время",
                callback_data: `schedule:${booking.id}`,
              },
            ],
          ],
        },
      },
    );
  }
}
export async function POST(request: Request) {
  if (!authorizedSecret(request.headers.get("x-telegram-bot-api-secret-token")))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!confirmationsReady())
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  let update: Update;
  try {
    const body = await readLimitedJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error();
    update = body as Update;
    if (!Number.isSafeInteger(update.update_id)) throw Error();
  } catch {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }
  try {
    await handle(update);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(
      `SAVA_WEBHOOK code=${e instanceof TelegramFailure ? e.code : "PROCESSING_ERROR"}`,
    );
    return NextResponse.json({ error: "Retry later" }, { status: 500 });
  }
}
