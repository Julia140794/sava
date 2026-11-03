import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { calendarInput, validDate } from "../lib/calendar.ts";

test("real PostgreSQL calendar migration and booking invariants", async (t) => {
  const db = new PGlite({ extensions: { btree_gist } });
  try {
    await db.exec(
      "create role anon;create role authenticated;create role service_role bypassrls;",
    );
    for (const name of [
      "leads.sql",
      "telegram-confirmations.sql",
      "calendar.sql",
    ])
      await db.exec(
        await readFile(
          new URL("../../supabase/" + name, import.meta.url),
          "utf8",
        ),
      );
    await db.exec(
      await readFile(
        new URL("../../supabase/calendar.sql", import.meta.url),
        "utf8",
      ),
    );
    const {
      rows: [{ day }],
    } = await db.query(
      "select to_char(d,'YYYY-MM-DD') as day from generate_series((now() at time zone 'Europe/Minsk')::date+2,(now() at time zone 'Europe/Minsk')::date+8,interval '1 day') d where extract(isodow from d)<>7 limit 1",
    );
    const at = (time) => `${day}T${time}:00+03:00`;
    const reserve = async (key, master, time, service = "manicure-bare") =>
      (
        await db.query(
          "select public.calendar_reserve($1::uuid,$2,$3,$4::timestamptz,$5,$6,$7,$8,$9::jsonb) as result",
          [
            key,
            service,
            master,
            at(time),
            "Test Client",
            "+375291234567",
            "",
            "https://site.invalid/",
            "{}",
          ],
        )
      ).rows[0].result;
    let first,
      firstKey = randomUUID(),
      second;
    await t.test(
      "migration is repeatable and catalog includes agreed staff durations",
      async () => {
        const r = await db.query(
          "select duration_minutes from calendar_services where id='manicure-polish'",
        );
        assert.equal(r.rows[0].duration_minutes, 120);
        assert.equal(
          (
            await db.query(
              "select count(*)::int as n from calendar_staff_services where staff_id='olga'",
            )
          ).rows[0].n,
          3,
        );
      },
    );
    await t.test(
      "reserves requested time and computes a 15 minute cleanup buffer",
      async () => {
        first = await reserve(firstKey, "yulia", "09:00");
        const {
          rows: [a],
        } = await db.query(
          "select extract(epoch from busy_until-starts_at)/60 as minutes from calendar_appointments where lead_id=$1",
          [first.lead_id],
        );
        assert.equal(Number(a.minutes), 75);
      },
    );
    await t.test(
      "same request is idempotent and changed payload cannot reuse it",
      async () => {
        assert.equal(
          (await reserve(firstKey, "yulia", "09:00")).lead_id,
          first.lead_id,
        );
        assert.equal(
          (await reserve(firstKey, "yulia", "09:00")).already_existed,
          true,
        );
        await assert.rejects(
          reserve(firstKey, "yulia", "12:00"),
          (e) => e.code === "22023",
        );
      },
    );
    await t.test(
      "database excludes overlapping requests and rolls back orphan leads",
      async () => {
        const before = (await db.query("select count(*)::int as n from leads"))
          .rows[0].n;
        await assert.rejects(
          reserve(randomUUID(), "yulia", "09:00"),
          (e) => e.code === "23P01",
        );
        assert.equal(
          (await db.query("select count(*)::int as n from leads")).rows[0].n,
          before,
        );
      },
    );
    await t.test("independent masters can work at the same time", async () => {
      const other = await reserve(randomUUID(), "olga", "09:00");
      assert(other.lead_id);
    });
    await t.test(
      "cleanup time is unavailable and exact next boundary is allowed",
      async () => {
        await assert.rejects(
          reserve(randomUUID(), "yulia", "10:00"),
          (e) => e.code === "23P01",
        );
        second = await reserve(randomUUID(), "yulia", "10:15");
        assert(second.lead_id);
      },
    );
    await t.test(
      "only eligible staff and business hours can be booked",
      async () => {
        await assert.rejects(
          reserve(randomUUID(), "olga", "12:00", "face-60"),
          (e) => e.code === "22023",
        );
        await assert.rejects(
          reserve(randomUUID(), "yulia", "08:00"),
          (e) => e.code === "22023",
        );
        await assert.rejects(
          reserve(randomUUID(), "yulia", "20:00", "manicure-polish"),
          (e) => e.code === "22023",
        );
        const late = await reserve(
          randomUUID(),
          "yulia",
          "19:45",
          "manicure-polish",
        );
        assert(late.lead_id);
      },
    );
    await t.test(
      "availability exposes only starts and respects buffer and Sunday",
      async () => {
        const r = await db.query(
          "select * from calendar_availability($1,$2,$3::date)",
          ["yulia", "manicure-bare", day],
        );
        assert(
          r.rows.every((row) => Object.keys(row).join(",") === "starts_at"),
        );
        assert(
          !r.rows.some(
            (row) =>
              new Date(row.starts_at).toISOString() ===
              new Date(at("10:00")).toISOString(),
          ),
        );
        const {
          rows: [{ sunday }],
        } = await db.query(
          "select to_char(d,'YYYY-MM-DD') as sunday from generate_series(current_date+2,current_date+9,interval '1 day') d where extract(isodow from d)=7 limit 1",
        );
        assert.equal(
          (
            await db.query(
              "select * from calendar_availability($1,$2,$3::date)",
              ["yulia", "manicure-bare", sunday],
            )
          ).rows.length,
          0,
        );
      },
    );
    await t.test("cancellation frees time and is idempotent", async () => {
      assert.equal(
        (
          await db.query("select calendar_cancel($1) as changed", [
            first.lead_id,
          ])
        ).rows[0].changed,
        true,
      );
      assert.equal(
        (
          await db.query("select calendar_cancel($1) as changed", [
            first.lead_id,
          ])
        ).rows[0].changed,
        false,
      );
      await assert.rejects(
        reserve(firstKey, "yulia", "09:00"),
        (e) => e.code === "22023",
      );
      first = await reserve(randomUUID(), "yulia", "09:00");
    });
    await t.test(
      "reschedule cannot collide and valid move changes the held interval",
      async () => {
        await assert.rejects(
          db.query("select calendar_move($1,$2::timestamptz)", [
            first.lead_id,
            at("10:15"),
          ]),
          (e) => e.code === "23P01",
        );
        await db.query("select calendar_move($1,$2::timestamptz)", [
          first.lead_id,
          at("12:00"),
        ]);
        assert.equal(
          new Date(
            (
              await db.query(
                "select starts_at from calendar_appointments where lead_id=$1",
                [first.lead_id],
              )
            ).rows[0].starts_at,
          ).toISOString(),
          new Date(at("12:00")).toISOString(),
        );
      },
    );
    await t.test(
      "closed intervals hide slots and can be reopened",
      async () => {
        const {
          rows: [block],
        } = await db.query(
          "insert into calendar_appointments(staff_id,kind,state,starts_at,ends_at,busy_until) values('yulia','block','confirmed',$1,$2,$2) returning id",
          [at("15:00"), at("16:00")],
        );
        let slots = (
          await db.query(
            "select * from calendar_availability($1,$2,$3::date)",
            ["yulia", "manicure-bare", day],
          )
        ).rows;
        assert(
          !slots.some(
            (r) =>
              new Date(r.starts_at).toISOString() ===
              new Date(at("14:00")).toISOString(),
          ),
        );
        await db.query(
          "update calendar_appointments set state='cancelled' where id=$1",
          [block.id],
        );
        slots = (
          await db.query(
            "select * from calendar_availability($1,$2,$3::date)",
            ["yulia", "manicure-bare", day],
          )
        ).rows;
        assert(
          slots.some(
            (r) =>
              new Date(r.starts_at).toISOString() ===
              new Date(at("14:00")).toISOString(),
          ),
        );
      },
    );
    await t.test(
      "confirmation claims once and blocks cancellation during send",
      async () => {
        await db.query(
          "insert into telegram_bookings(id,token_hash,expires_at,service,client_chat_id,appointment_at,preview_nonce) values($1,$2,now()+interval '1 day','Test','200',$3,$4)",
          [first.lead_id, "a".repeat(64), at("12:00"), "b".repeat(16)],
        );
        assert.equal(
          (
            await db.query(
              "select * from calendar_prepare_confirmation($1,$2)",
              [first.lead_id, "wrong"],
            )
          ).rows.length,
          0,
        );
        assert.equal(
          (
            await db.query(
              "select * from calendar_prepare_confirmation($1,$2)",
              [first.lead_id, "b".repeat(16)],
            )
          ).rows.length,
          1,
        );
        assert.equal(
          (
            await db.query(
              "select * from calendar_prepare_confirmation($1,$2)",
              [first.lead_id, "b".repeat(16)],
            )
          ).rows.length,
          0,
        );
        await assert.rejects(
          db.query("select calendar_cancel($1)", [first.lead_id]),
          (e) => e.code === "22023",
        );
        await db.query(
          "update telegram_bookings set delivery_status='delivered' where id=$1",
          [first.lead_id],
        );
        await db.query("select calendar_cancel($1)", [first.lead_id]);
        assert.equal(
          (
            await db.query(
              "select * from calendar_prepare_confirmation($1,$2)",
              [first.lead_id, "b".repeat(16)],
            )
          ).rows.length,
          0,
        );
      },
    );
    await t.test(
      "anonymous roles cannot read reservations or invoke booking functions",
      async () => {
        await db.exec("set role anon");
        try {
          await assert.rejects(
            db.query("select * from public.calendar_appointments"),
            (e) => e.code === "42501",
          );
          await assert.rejects(
            db.query(
              "select * from public.calendar_availability($1,$2,$3::date)",
              ["yulia", "manicure-bare", day],
            ),
            (e) => e.code === "42501",
          );
        } finally {
          await db.exec("reset role");
        }
      },
    );
    await t.test("JavaScript and database enforce the same time rules", () => {
      const iso = (time) => new Date(at(time)).toISOString();
      assert.equal(
        calendarInput("manicure-polish", "olga", iso("19:45"))?.duration,
        120,
      );
      assert.equal(
        calendarInput("manicure-polish", "olga", iso("20:00")),
        null,
      );
      assert.equal(calendarInput("face-60", "olga", iso("12:00")), null);
      assert.equal(validDate("2030-02-31"), false);
    });
  } finally {
    await db.close();
  }
});
