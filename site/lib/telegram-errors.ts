// Return only fixed codes: never forward Telegram response text into logs.
export function classifyTelegramError(
  status: number,
  description: unknown,
): string {
  const text = typeof description === "string" ? description.toLowerCase() : "";
  if (status === 401 || status === 404) return "INVALID_TOKEN";
  if (text.includes("chat not found")) return "CHAT_NOT_FOUND";
  if (text.includes("blocked")) return "BOT_BLOCKED";
  if (text.includes("stopped by the user")) return "BOT_STOPPED";
  if (text.includes("deactivated")) return "RECIPIENT_DEACTIVATED";
  if (text.includes("send messages to bots")) return "RECIPIENT_IS_BOT";
  if (text.includes("can't initiate") || text.includes("cannot initiate"))
    return "START_REQUIRED";
  if (text.includes("kicked")) return "BOT_REMOVED_FROM_CHAT";
  if (text.includes("not a member")) return "BOT_NOT_IN_CHAT";
  if (
    text.includes("not enough rights") ||
    text.includes("no rights") ||
    text.includes("chat_write_forbidden")
  )
    return "CHAT_WRITE_FORBIDDEN";
  if (status === 429) return "RATE_LIMITED";
  return "TELEGRAM_REJECTED";
}
