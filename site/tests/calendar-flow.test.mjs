import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { NextRequest } from "next/server";
import { POST as legacyLead } from "../app/api/lead/route.ts";
import { POST as book } from "../app/api/calendar/book/route.ts";
import { GET as available } from "../app/api/calendar/route.ts";
import { POST as webhook } from "../app/api/telegram/webhook/route.ts";
import { POST as manage } from "../app/api/calendar/manage/route.ts";

test("calendar HTTP handlers and Telegram use real database reservations", async (t) => {
  const db = new PGlite({ extensions: { btree_gist } }),
    original = globalThis.fetch;
  const env = {
    CALENDAR_ENABLED: "true",
    LEAD_INTAKE_ENABLED: "true",
    SUPABASE_URL: "https://calendar-db.invalid",
    SUPABASE_SECRET_KEY: "fixture-key",
    TELEGRAM_BOT_TOKEN: "fixture-token",
    TELEGRAM_CHAT_ID: "100",
    SITE_URL: "https://savae.netlify.app",
    TELEGRAM_CONFIRMATIONS_ENABLED: "true",
    TELEGRAM_WEBHOOK_SECRET: "a".repeat(64),
  };
  const previous = Object.fromEntries(
    Object.keys(env).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, env);
  const messages = [];
  let messageId = 100,
    updateId = 0;
  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;",
  );
  for (const file of [
    "leads.sql",
    "telegram-confirmations.sql",
    "calendar.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../../supabase/" + file, import.meta.url),
        "utf8",
      ),
    );
  const {
    rows: [{ day }],
  } = await db.query(
    "select to_char(d,'YYYY-MM-DD') as day from generate_series(current_date+2,current_date+8,interval '1 day') d where extract(isodow from d)<>7 limit 1",
  );
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input)),
      body = init.body ? JSON.parse(String(init.body)) : {};
    if (url.hostname === "api.telegram.org") {
      const method = url.pathname.split("/").at(-1);
      if (method === "getMe")
        return json({ ok: true, result: { username: "sava_test_bot" } });
      if (method === "answerCallbackQuery")
        return json({ ok: true, result: true });
      assert.equal(method, "sendMessage");
      const m = { ...body, message_id: ++messageId };
      messages.push(m);
      return json({ ok: true, result: m });
    }
    assert.equal(
      url.hostname,
      "calendar-db.invalid",
      "No real network calls allowed",
    );
    try {
      if (url.pathname.includes("/rpc/")) {
        const fn = url.pathname.split("/").at(-1);
        const signatures = {
          calendar_reserve: [
            "p_request_key",
            "p_service",
            "p_staff",
            "p_start",
            "p_name",
            "p_phone",
            "p_message",
            "p_page",
            "p_utm",
          ],
          calendar_availability: ["p_staff", "p_service", "p_date"],
          calendar_cancel: ["p_lead"],
          calendar_move: ["p_lead", "p_start"],
          calendar_prepare_confirmation: ["p_lead", "p_nonce"],
        };
        assert(fn in signatures);
        const args = signatures[fn].map((k) => body[k]);
        const placeholders = args.map((_, i) => "$" + (i + 1)).join(",");
        if (
          ["calendar_availability", "calendar_prepare_confirmation"].includes(
            fn,
          )
        )
          return json(
            (
              await db.query(
                `select * from public.${fn}(${placeholders})`,
                args,
              )
            ).rows,
          );
        return json(
          (
            await db.query(
              `select public.${fn}(${placeholders}) as result`,
              args,
            )
          ).rows[0].result,
        );
      }
      const table = url.pathname.split("/").at(-1);
      assert(
        ["telegram_bookings", "leads", "calendar_appointments"].includes(table),
      );
      const values = [],
        parts = [];
      for (const [k, v] of url.searchParams) {
        if (["select", "order", "limit", "on_conflict"].includes(k)) continue;
        assert(/^[a-z_]+$/.test(k));
        if (v === "is.null") {
          parts.push(`${k} is null`);
          continue;
        }
        if (v === "not.is.null") {
          parts.push(`${k} is not null`);
          continue;
        }
        const m = /^(eq|neq|gt|lt)\.(.*)$/.exec(v);
        assert(m);
        values.push(m[2]);
        parts.push(
          `${k} ${{ eq: "=", neq: "<>", gt: ">", lt: "<" }[m[1]]} $${values.length}`,
        );
      }
      const where = parts.length ? " where " + parts.join(" and ") : "";
      let rows;
      if (init.method === "POST") {
        const keys = Object.keys(body);
        keys.forEach((k) => assert(/^[a-z_]+$/.test(k)));
        rows = (
          await db.query(
            `insert into ${table}(${keys.join(",")}) values(${keys.map((_, i) => "$" + (i + 1)).join(",")}) ${url.searchParams.has("on_conflict") ? "on conflict(id) do nothing" : ""} returning *`,
            keys.map((k) => body[k]),
          )
        ).rows;
        return new Response(null, { status: 201 });
      }
      if (init.method === "PATCH") {
        const keys = Object.keys(body);
        keys.forEach((k) => assert(/^[a-z_]+$/.test(k)));
        const set = keys
          .map((k) => {
            values.push(body[k]);
            return `${k}=$${values.length}`;
          })
          .join(",");
        rows = (
          await db.query(
            `update ${table} set ${set}${where} returning *`,
            values,
          )
        ).rows;
      } else
        rows = (await db.query(`select * from ${table}${where}`, values)).rows;
      const h = new Headers(init.headers);
      return json(
        h.get("accept")?.includes("vnd.pgrst.object") ? rows[0] || null : rows,
      );
    } catch (e) {
      return json(
        {
          code: e.code || "TEST_ERROR",
          message: "Redacted fixture database error",
        },
        e.code === "23P01" ? 409 : 400,
      );
    }
  };
  const req = (body) =>
    new NextRequest("https://savae.netlify.app/api/calendar/book", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://savae.netlify.app",
        "x-forwarded-for": String(++messageId),
      },
      body: JSON.stringify(body),
    });
  const start = new Date(`${day}T09:00:00+03:00`).toISOString();
  const data = {
    name: "Calendar Client",
    phone: "+375291234567",
    consent: true,
    service: "manicure-bare",
    staff: "yulia",
    startsAt: start,
    requestKey: randomUUID(),
  };
  const update = (body) =>
    webhook(
      new Request("https://savae.netlify.app/api/telegram/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-bot-api-secret-token": "a".repeat(64),
        },
        body: JSON.stringify({ update_id: ++updateId, ...body }),
      }),
    );
  const callback = (value) => ({
    callback_query: {
      id: "q" + ++messageId,
      data: value,
      from: { id: 100 },
      message: { message_id: ++messageId, chat: { id: 100, type: "private" } },
    },
  });
  let leadId, link;
  try {
    await t.test(
      "cached legacy forms cannot bypass calendar reservation",
      async () => {
        const res = await legacyLead(
          new NextRequest("https://savae.netlify.app/api/lead", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "Legacy",
              phone: "+375291234567",
              service: "face",
              consent: true,
            }),
          }),
        );
        assert.equal(res.status, 409);
      },
    );
    await t.test(
      "public catalog and slots disclose no customer fields",
      async () => {
        const r = await available(
          new NextRequest("https://savae.netlify.app/api/calendar"),
        );
        assert.equal((await r.json()).enabled, true);
        const slots = await available(
          new NextRequest(
            `https://savae.netlify.app/api/calendar?date=${day}&staff=yulia&service=manicure-bare`,
          ),
        );
        assert.equal(slots.status, 200);
        const b = await slots.json();
        assert(b.slots.includes(start));
        assert.deepEqual(Object.keys(b), ["slots"]);
      },
    );
    await t.test(
      "book endpoint reserves a slot and supplies a private Telegram link",
      async () => {
        const r = await book(req(data));
        assert.equal(r.status, 200);
        const b = await r.json();
        assert.equal(b.appointment.master, "Юлия");
        link = new URL(b.telegramUrl).searchParams.get("start");
        leadId = (await db.query("select lead_id from calendar_appointments"))
          .rows[0].lead_id;
        assert.equal(messages.length, 1);
        assert(messages[0].text.includes("09:00"));
      },
    );
    await t.test(
      "retry does not create a second lead or duplicate owner notification",
      async () => {
        const r = await book(req(data));
        assert.equal(r.status, 200);
        assert.equal(
          (await db.query("select count(*)::int as n from leads")).rows[0].n,
          1,
        );
        assert.equal(messages.length, 1);
        assert.equal(
          new URL((await r.json()).telegramUrl).searchParams.get("start"),
          link,
        );
      },
    );
    await t.test(
      "another request for same time gets 409, another master succeeds",
      async () => {
        assert.equal(
          (await book(req({ ...data, requestKey: randomUUID() }))).status,
          409,
        );
        assert.equal(
          (
            await book(
              req({ ...data, staff: "olga", requestKey: randomUUID() }),
            )
          ).status,
          200,
        );
      },
    );
    await t.test(
      "client binds and owner gets confirmation of selected slot",
      async () => {
        const r = await update({
          message: {
            message_id: ++messageId,
            text: "/start " + link,
            chat: { id: 200, type: "private" },
            from: { id: 200 },
          },
        });
        assert.equal(r.status, 200);
        const ownerMessage = messages.findLast(
          (m) => m.chat_id === "100" && m.text.includes("Клиент подключил"),
        );
        assert(
          ownerMessage.reply_markup.inline_keyboard[0][0].callback_data.startsWith(
            "confirm:",
          ),
        );
        const row = (
          await db.query("select * from telegram_bookings where id=$1", [
            leadId,
          ])
        ).rows[0];
        const action = `confirm:${leadId}:${row.preview_nonce}`;
        assert.equal((await update(callback(action))).status, 200);
        assert.equal(
          (
            await db.query(
              "select state from calendar_appointments where lead_id=$1",
              [leadId],
            )
          ).rows[0].state,
          "confirmed",
        );
        assert(
          messages.some(
            (m) =>
              m.chat_id === "200" &&
              m.text.includes("подтверждена!") &&
              m.text.includes("09:00"),
          ),
        );
        await update(callback(action));
        assert.equal(
          messages.filter(
            (m) => m.chat_id === "200" && m.text.includes("подтверждена!"),
          ).length,
          1,
        );
      },
    );
    await t.test(
      "owner cancellation frees the slot and cannot send stale confirmation",
      async () => {
        const r = await update(callback(`cancel:${leadId}`));
        assert.equal(r.status, 200);
        assert.equal(
          (
            await db.query(
              "select state from calendar_appointments where lead_id=$1",
              [leadId],
            )
          ).rows[0].state,
          "cancelled",
        );
        assert(
          messages.some(
            (m) => m.chat_id === "200" && m.text.includes("отменена"),
          ),
        );
        const count = messages.filter((m) =>
          m.text.includes("подтверждена!"),
        ).length;
        await update(callback(`confirm:${leadId}:${"b".repeat(16)}`));
        assert.equal(
          messages.filter((m) => m.text.includes("подтверждена!")).length,
          count,
        );
      },
    );
    await t.test(
      "administrative API refuses unauthenticated mutations",
      async () => {
        const r = await manage(
          new Request("https://savae.netlify.app/api/calendar/manage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "cancel", leadId, secret: "wrong" }),
          }),
        );
        assert.equal(r.status, 403);
      },
    );
  } finally {
    globalThis.fetch = original;
    for (const k of Object.keys(env)) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
    }
    await db.close();
  }
});
