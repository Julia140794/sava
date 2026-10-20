import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { classifyTelegramError } from "./telegram-errors";
export function confirmationsReady() {
  return (
    process.env.TELEGRAM_CONFIRMATIONS_ENABLED?.trim() === "true" &&
    /^[A-Za-z0-9_-]{32,256}$/.test(
      process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || "",
    ) &&
    !!process.env.SITE_URL
  );
}
export function bookingDb() {
  return createClient(
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
}
export function authorizedSecret(value: string | null) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || "";
  if (!expected || !value) return false;
  const a = Buffer.from(value),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function hashLink(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export class TelegramFailure extends Error {
  constructor(
    public code: string,
    public uncertain = false,
  ) {
    super(code);
  }
}
export async function botCall(
  method: string,
  payload: Record<string, unknown> = {},
) {
  let result: Response;
  try {
    result = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN!.trim()}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      },
    );
  } catch {
    throw new TelegramFailure("CONNECTION_ERROR", true);
  }
  let data;
  try {
    data = await result.json();
  } catch {
    throw new TelegramFailure("INVALID_RESPONSE", true);
  }
  if (!result.ok || data.ok !== true)
    throw new TelegramFailure(
      classifyTelegramError(result.status, data.description),
      result.status >= 500,
    );
  return data.result;
}
export async function sendText(
  chatId: string,
  text: string,
  extra: Record<string, unknown> = {},
) {
  return botCall("sendMessage", { chat_id: chatId, text, ...extra });
}
export function scheduleKeyboard(id: string) {
  return {
    inline_keyboard: [
      [
        {
          text: "Выбрать время и подтвердить",
          callback_data: `schedule:${id}`,
        },
      ],
    ],
  };
}
export function formatAppointment(iso: string) {
  return new Intl.DateTimeFormat("ru-BY", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Minsk",
  }).format(new Date(iso));
}
export function parseAppointment(
  value: string,
  now = Date.now(),
): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [day, month, year, hour, minute] = m.slice(1).map(Number);
  if (
    year < 2026 ||
    year > 2100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  )
    return null;
  const local = Date.UTC(year, month - 1, day, hour, minute);
  const d = new Date(local);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  )
    return null;
  const utc = local - 3 * 60 * 60 * 1000;
  return utc > now ? new Date(utc).toISOString() : null;
}
export async function readLimitedJson(
  request: Request,
  max = 32768,
): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw Error("EMPTY_BODY");
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw Error("BODY_TOO_LARGE");
    }
    parts.push(value);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
