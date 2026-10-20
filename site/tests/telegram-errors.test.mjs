import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTelegramError } from "../lib/telegram-errors.ts";
const cases = [
  [403, "Forbidden: bots can't send messages to bots", "RECIPIENT_IS_BOT"],
  [403, "Forbidden: user is deactivated", "RECIPIENT_DEACTIVATED"],
  [403, "Forbidden: bot was blocked by the user", "BOT_BLOCKED"],
  [403, "Forbidden: bot was stopped by the user", "BOT_STOPPED"],
  [
    403,
    "Forbidden: bot can't initiate conversation with a user",
    "START_REQUIRED",
  ],
  [
    403,
    "Forbidden: bot was kicked from the group chat",
    "BOT_REMOVED_FROM_CHAT",
  ],
  [
    403,
    "Forbidden: bot is not a member of the channel chat",
    "BOT_NOT_IN_CHAT",
  ],
  [
    400,
    "Bad Request: not enough rights to send text messages",
    "CHAT_WRITE_FORBIDDEN",
  ],
  [400, "Bad Request: chat not found", "CHAT_NOT_FOUND"],
  [401, "Unauthorized", "INVALID_TOKEN"],
  [404, "Not Found", "INVALID_TOKEN"],
  [429, "Too Many Requests", "RATE_LIMITED"],
];
for (const [status, description, expected] of cases) {
  test(expected + ": " + status, () =>
    assert.equal(classifyTelegramError(status, description), expected),
  );
}
test("unknown response text and private details never become a log code", () => {
  for (const description of [
    undefined,
    null,
    { token: "private-value" },
    "private-value +375291234567",
  ]) {
    assert.equal(classifyTelegramError(403, description), "TELEGRAM_REJECTED");
  }
});
