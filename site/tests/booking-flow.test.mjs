import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { POST as lead } from "../app/api/lead/route.ts";
import { POST as webhook } from "../app/api/telegram/webhook/route.ts";
import {
  POST as setup,
  GET as setupStatus,
} from "../app/api/telegram/setup/route.ts";
import { parseAppointment } from "../lib/telegram-booking.ts";

test("confirmation workflow: recipient binding, owner authorization, date preview and single delivery", async (t) => {
  const names = [
    "LEAD_INTAKE_ENABLED",
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "SITE_URL",
    "TELEGRAM_CONFIRMATIONS_ENABLED",
    "TELEGRAM_WEBHOOK_SECRET",
  ];
  const previous = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  Object.assign(process.env, {
    LEAD_INTAKE_ENABLED: "true",
    SUPABASE_URL: "https://db.invalid",
    SUPABASE_SECRET_KEY: "test-key",
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_CHAT_ID: "100",
    SITE_URL: "https://savae.netlify.app",
    TELEGRAM_CONFIRMATIONS_ENABLED: "true",
    TELEGRAM_WEBHOOK_SECRET: "a".repeat(64),
  });
  const originalFetch = globalThis.fetch;
  const tables = { leads: [], telegram_bookings: [] };
  const messages = [];
  let messageId = 1000,
    updateId = 0,
    failClient = false;
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (url.hostname === "api.telegram.org") {
      const method = url.pathname.split("/").at(-1);
      if (method === "getMe")
        return json({ ok: true, result: { username: "sava_test_bot" } });
      if (method === "setWebhook") return json({ ok: true, result: true });
      if (method === "getWebhookInfo")
        return json({
          ok: true,
          result: { url: "https://savae.netlify.app/api/telegram/webhook" },
        });
      if (method === "answerCallbackQuery")
        return json({ ok: true, result: true });
      assert.equal(method, "sendMessage");
      if (
        failClient &&
        String(body.chat_id) === "200" &&
        body.text.includes("подтверждена!")
      )
        throw Error("simulated timeout");
      const m = { ...body, message_id: ++messageId };
      messages.push(m);
      return json({ ok: true, result: m });
    }
    assert.equal(
      url.hostname,
      "db.invalid",
      "No real external request is permitted",
    );
    const table = url.pathname.split("/").at(-1);
    assert(table in tables);
    const matches = (row) =>
      [...url.searchParams].every(([k, v]) => {
        if (["select", "limit"].includes(k)) return true;
        if (v === "is.null") return row[k] == null;
        if (v === "not.is.null") return row[k] != null;
        if (v.startsWith("eq.")) return String(row[k]) === v.slice(3);
        if (v.startsWith("gt.")) return row[k] > v.slice(3);
        throw Error("Unknown query " + k + " " + v);
      });
    const rows = tables[table].filter(matches);
    if (init.method === "POST") {
      const values = Array.isArray(body) ? body : [body];
      for (const v of values)
        tables[table].push(
          table === "telegram_bookings"
            ? { client_chat_id: null, delivery_status: "pending", ...v }
            : v,
        );
      return new Response(null, { status: 201 });
    }
    if (init.method === "PATCH") {
      for (const r of rows) Object.assign(r, body);
      return json(rows);
    }
    if (url.searchParams.get("limit") === "0") return json([]);
    const headers = new Headers(init.headers);
    return json(
      headers.get("accept")?.includes("vnd.pgrst.object")
        ? rows[0] || null
        : rows,
    );
  };
  const invoke = async (body, secret = "a".repeat(64)) =>
    webhook(
      new Request("https://savae.netlify.app/api/telegram/webhook", {
        method: "POST",
        headers: {
          "x-telegram-bot-api-secret-token": secret,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ update_id: ++updateId, ...body }),
      }),
    );
  const clientStart = (token, id = 200) => ({
    message: {
      message_id: ++messageId,
      text: "/start " + token,
      chat: { id, type: "private" },
      from: { id, is_bot: false },
    },
  });
  const callback = (data, id = 100) => ({
    callback_query: {
      id: "callback-" + ++messageId,
      from: { id },
      data,
      message: { message_id: ++messageId, chat: { id: 100, type: "private" } },
    },
  });
  try {
    await t.test(
      "reject forged webhook before making external calls",
      async () => {
        const count = messages.length;
        assert.equal((await invoke({}, "wrong")).status, 403);
        assert.equal(messages.length, count);
      },
    );
    let link, booking;
    await t.test(
      "create normal lead and a private expiring link, storing only its hash",
      async () => {
        const res = await lead(
          new NextRequest("https://savae.netlify.app/api/lead", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: "https://savae.netlify.app",
            },
            body: JSON.stringify({
              name: "Test Client",
              phone: "+375291234567",
              service: "face",
              consent: true,
            }),
          }),
        );
        assert.equal(res.status, 200);
        const result = await res.json();
        link = new URL(result.telegramUrl).searchParams.get("start");
        booking = tables.telegram_bookings[0];
        assert.equal(link.length, 43);
        assert.equal(booking.token_hash.length, 64);
        assert(!JSON.stringify(booking).includes(link));
        assert(messages[0].reply_markup);
      },
    );
    await t.test("strangers cannot schedule or confirm a booking", async () => {
      const count = messages.length;
      assert.equal(
        (await invoke(callback("schedule:" + booking.id, 300))).status,
        200,
      );
      assert.equal(messages.length, count);
      assert(!booking.owner_prompt_id);
    });
    await t.test(
      "client claims their own link, and a different account cannot steal it",
      async () => {
        assert.equal((await invoke(clientStart(link))).status, 200);
        assert.equal(booking.client_chat_id, "200");
        await invoke(clientStart(link, 300));
        assert.equal(booking.client_chat_id, "200");
        assert(messages.at(-1).text.includes("недействительна"));
      },
    );
    await t.test(
      "owner receives a reply prompt tied to the correct client",
      async () => {
        assert.equal(
          (await invoke(callback("schedule:" + booking.id))).status,
          200,
        );
        assert(booking.owner_prompt_id);
        assert(messages.at(-1).text.includes("Test Client"));
      },
    );
    await t.test(
      "repeated client Start does not notify the owner again",
      async () => {
        const count = messages.filter(
          (m) =>
            String(m.chat_id) === "100" && m.text.includes("Клиент подключил"),
        ).length;
        await invoke(clientStart(link));
        assert.equal(
          messages.filter(
            (m) =>
              String(m.chat_id) === "100" &&
              m.text.includes("Клиент подключил"),
          ).length,
          count,
        );
      },
    );
    const reply = (text) => ({
      message: {
        message_id: ++messageId,
        text,
        from: { id: 100 },
        chat: { id: 100, type: "private" },
        reply_to_message: { message_id: booking.owner_prompt_id },
      },
    });
    await t.test(
      "reject impossible/past dates, then render preview in Minsk time",
      async () => {
        assert.equal(parseAppointment("31.02.2030 10:00"), null);
        assert.equal(parseAppointment("01.01.2020 10:00"), null);
        assert.equal(
          parseAppointment("25.10.2030 14:30", 0),
          "2030-10-25T11:30:00.000Z",
        );
        await invoke(reply("31.02.2030 10:00"));
        assert(!booking.preview_nonce);
        await invoke(reply("25.10.2030 14:30"));
        assert(booking.preview_nonce);
        assert(messages.at(-1).text.includes("14:30"));
        assert(
          !messages.some(
            (m) => m.chat_id === "200" && m.text.includes("подтверждена!"),
          ),
        );
      },
    );
    let confirm;
    await t.test(
      "older previews are invalidated and owner must click final confirmation",
      async () => {
        const old = booking.preview_nonce;
        await invoke(reply("25.10.2030 15:30"));
        assert.notEqual(booking.preview_nonce, old);
        await invoke(callback(`confirm:${booking.id}:${old}`));
        assert.equal(booking.delivery_status, "pending");
        confirm = `confirm:${booking.id}:${booking.preview_nonce}`;
      },
    );
    await t.test(
      "confirmation is delivered once even when webhook is retried",
      async () => {
        assert.equal((await invoke(callback(confirm))).status, 200);
        assert.equal(booking.delivery_status, "delivered");
        await invoke(callback(confirm));
        assert.equal(
          messages.filter(
            (m) =>
              String(m.chat_id) === "200" && m.text.includes("подтверждена!"),
          ).length,
          1,
        );
      },
    );
    await t.test(
      "reopening a confirmed link shows the confirmed appointment",
      async () => {
        await invoke(clientStart(link));
        assert(messages.at(-1).text.includes("уже подтверждена"));
      },
    );
    await t.test("expired unclaimed links cannot be used", async () => {
      const copy = {
        ...booking,
        id: "00000000-0000-4000-8000-000000000000",
        client_chat_id: null,
        expires_at: "2000-01-01T00:00:00.000Z",
        token_hash: booking.token_hash,
      };
      booking.token_hash = "f".repeat(64);
      tables.telegram_bookings.push(copy);
      await invoke(clientStart(link));
      assert.equal(copy.client_chat_id, null);
    });
    await t.test(
      "ambiguous send failure is held for review instead of blindly repeated",
      async () => {
        booking.delivery_status = "pending";
        booking.preview_nonce = "b".repeat(16);
        failClient = true;
        const action = `confirm:${booking.id}:${booking.preview_nonce}`;
        await invoke(callback(action));
        assert.equal(booking.delivery_status, "uncertain");
        const before = messages.length;
        await invoke(callback(action));
        assert.equal(booking.delivery_status, "uncertain");
        assert.equal(messages.length, before + 1);
      },
    );
    await t.test(
      "setup rejects wrong secret and registers only the canonical webhook",
      async () => {
        const req = (secret) =>
          new Request("https://savae.netlify.app/api/telegram/setup", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: "https://savae.netlify.app",
            },
            body: JSON.stringify({ secret }),
          });
        assert.equal((await setup(req("wrong"))).status, 403);
        assert.equal((await setup(req("a".repeat(64)))).status, 200);
      },
    );
    await t.test(
      "setup diagnoses missing and malformed secrets without exposing values",
      async () => {
        const configured = process.env.TELEGRAM_WEBHOOK_SECRET;
        try {
          delete process.env.TELEGRAM_WEBHOOK_SECRET;
          const missing = await (await setupStatus()).json();
          assert.equal(missing.secretConfigured, false);
          const req = new Request(
            "https://savae.netlify.app/api/telegram/setup",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ secret: "a".repeat(64) }),
            },
          );
          const res = await setup(req);
          assert.equal(res.status, 503);
          assert((await res.json()).error.includes("Production"));
          process.env.TELEGRAM_WEBHOOK_SECRET = "invalid short secret";
          const malformed = await (await setupStatus()).json();
          assert.equal(malformed.secretFormatValid, false);
          assert(!JSON.stringify(malformed).includes("invalid short secret"));
          process.env.TELEGRAM_WEBHOOK_SECRET = configured;
          const status = await setupStatus();
          assert.equal(status.headers.get("cache-control"), "no-store");
          assert(!JSON.stringify(await status.json()).includes(configured));
          const padded = new Request(
            "https://savae.netlify.app/api/telegram/setup",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ secret: "  " + configured + "\n" }),
            },
          );
          assert.equal((await setup(padded)).status, 200);
        } finally {
          process.env.TELEGRAM_WEBHOOK_SECRET = configured;
        }
      },
    );
    await t.test(
      "legacy lead submission still works with feature off",
      async () => {
        process.env.TELEGRAM_CONFIRMATIONS_ENABLED = "false";
        const count = tables.telegram_bookings.length;
        const res = await lead(
          new NextRequest("https://savae.netlify.app/api/lead", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "Legacy",
              phone: "+375291234567",
              service: "manicure",
              consent: true,
            }),
          }),
        );
        assert.equal(res.status, 200);
        assert.equal((await res.json()).telegramUrl, undefined);
        assert.equal(tables.telegram_bookings.length, count);
      },
    );
    await t.test("client can disable confirmations with stop", async () => {
      process.env.TELEGRAM_CONFIRMATIONS_ENABLED = "true";
      await invoke({
        message: {
          message_id: ++messageId,
          text: "/stop",
          chat: { id: 200, type: "private" },
          from: { id: 200, is_bot: false },
        },
      });
      assert.equal(booking.client_chat_id, null);
      assert.equal(booking.preview_nonce, null);
      assert(messages.at(-1).text.includes("отключены"));
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const n of names) {
      if (previous[n] === undefined) delete process.env[n];
      else process.env[n] = previous[n];
    }
  }
});
