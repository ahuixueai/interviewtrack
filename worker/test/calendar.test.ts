import { describe, expect, it } from "vitest";
import { handleApi } from "../src/api.js";
import { calendarToken, handleCalendar } from "../src/calendar.js";
import { handleIncoming } from "../src/inbox.js";
import type { IncomingMail } from "../src/inbox.js";
import type { Env } from "../src/types.js";
import { ME, ownerSetting } from "./helpers.js";
import { testDb } from "./testDb.js";
const NOW = Date.parse("2026-10-13T04:00:00Z");
const PASSWORD = "test-board-password";

function mail(id: string, subject: string, text: string): IncomingMail {
  return {
    envelopeFrom: "bounce@x.example",
    envelopeTo: "jobs@my.example",
    headers: [{ key: "x-forwarded-for", value: `${ME} jobs@my.example` }],
    from: "星河科技校园招聘 <campus@xinghe.example>",
    subject,
    text,
    html: undefined,
    date: "Mon, 12 Oct 2026 11:00:00 +0800",
    messageId: `<${id}@x>`,
  };
}

async function setup() {
  const fake = testDb();
  const env: Env = { DB: fake.db, ALLOWED_FORWARDERS: ME, BOARD_PASSWORD: PASSWORD, OWNER_EMAIL: "owner@example.com", INBOX_DOMAIN: "my.example" };
  let n = 0;
  await handleIncoming(mail("a", "【星河科技】在线笔试通知", "考试时间：10月20日 19:00-20:40（北京时间）"), env, NOW, () => `id-${++n}`);
  await handleIncoming(mail("b", "【北辰】面试邀请", "面试时间：10月21日 14:00（北京时间）"), env, NOW, () => `id-${++n}`);
  return { ...fake, env };
}

/** 作者账号现在用的日历口令（直接从库里读）。 */
function ownerToken(fake: { all<T = Record<string, unknown>>(sql: string): T[] }): string {
  return fake.all<{ calendar_token: string }>("SELECT calendar_token FROM users WHERE role = 'owner'")[0]!.calendar_token;
}

describe("日历订阅", () => {
  it("口令不对：一律 404，不透露任何东西", async () => {
    const { env } = await setup();
    const bad = await handleCalendar(new Request(`https://board.example/cal/${"0".repeat(40)}.ics`), env, NOW);
    expect(bad.status).toBe(404);
    const junk = await handleCalendar(new Request("https://board.example/cal/abc.ics"), env, NOW);
    expect(junk.status).toBe(404);
  });

  it("口令对：返回日程里有时刻的事；删掉的信不再出现", async () => {
    const fake = await setup();
    const { env } = fake;
    const token = ownerToken(fake);
    const res = await handleCalendar(new Request(`https://board.example/cal/${token}.ics`), env, NOW);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");
    const ics = await res.text();
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("DTSTART:20261020T110000Z");
    expect(ics).toContain("DTSTART:20261021T060000Z");
    expect(ics.split("BEGIN:VEVENT")).toHaveLength(3);

    await ownerSetting(env, "edits", JSON.stringify({ version: 1, deletedEmails: { "id-1": 1 } }));
    const after = await (await handleCalendar(new Request(`https://board.example/cal/${token}.ics`), env, NOW)).text();
    expect(after).not.toContain("DTSTART:20261020T110000Z");
    expect(after).toContain("DTSTART:20261021T060000Z");

    // 日历口令和登录密码已经脱钩：改密码不影响已订阅的日历
    const changed = await handleCalendar(new Request(`https://board.example/cal/${token}.ics`), { ...env, BOARD_PASSWORD: "new-password" }, NOW);
    expect(changed.status).toBe(200);
  });

  it("换一个新链接：新链接能用，旧链接立刻 404", async () => {
    const fake = await setup();
    const { env } = fake;
    const login = await handleApi(new Request("https://board.example/api/login", { method: "POST", body: JSON.stringify({ password: PASSWORD }), headers: { "cf-connecting-ip": "1.1.1.1" } }), env, NOW);
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
    const old = ownerToken(fake);
    const res = await handleApi(new Request("https://board.example/api/calendar/reset", { method: "POST", headers: { cookie } }), env, NOW);
    const { url } = (await res.json()) as { url: string };
    expect(url).not.toContain(old);
    expect((await handleCalendar(new Request(url), env, NOW)).status).toBe(200);
    expect((await handleCalendar(new Request(`https://board.example/cal/${old}.ics`), env, NOW)).status).toBe(404);
  });

  it("看板里拿到的订阅链接就是这个口令", async () => {
    const fake = await setup();
    const { env } = fake;
    const login = await handleApi(new Request("https://board.example/api/login", { method: "POST", body: JSON.stringify({ password: PASSWORD }), headers: { "cf-connecting-ip": "1.1.1.1" } }), env, NOW);
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
    const res = await handleApi(new Request("https://board.example/api/calendar", { headers: { cookie } }), env, NOW);
    const { url } = (await res.json()) as { url: string };
    expect(url).toBe(`https://board.example/cal/${ownerToken(fake)}.ics`);
  });

  it("提醒提前量：设置里改了，日历跟着变；乱填的值存不进去", async () => {
    const fake = await setup();
    const { env } = fake;
    const login = await handleApi(new Request("https://board.example/api/login", { method: "POST", body: JSON.stringify({ password: PASSWORD }), headers: { "cf-connecting-ip": "1.1.1.1" } }), env, NOW);
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
    const token = ownerToken(fake);
    const ics = async () => (await handleCalendar(new Request(`https://board.example/cal/${token}.ics`), env, NOW)).text();
    expect(await ics()).toContain("TRIGGER:-PT30M");

    const put = (body: unknown) =>
      handleApi(new Request("https://board.example/api/prefs", { method: "PUT", headers: { cookie }, body: JSON.stringify(body) }), env, NOW);
    const saved = (await (await put({ calendar: { fixedAlarm: 60, deadlineAlarm: null } })).json()) as { prefs: unknown };
    expect(saved.prefs).toEqual({ version: 1, calendar: { fixedAlarm: 60, deadlineAlarm: null, emailReminders: true }, timeZones: { home: null, job: null }, deviceZone: null });
    const after = await ics();
    expect(after).toContain("TRIGGER:-PT1H");
    expect(after).not.toContain("TRIGGER:-PT30M");

    await put({ calendar: { fixedAlarm: 7, deadlineAlarm: "x" } });
    const got = (await (await handleApi(new Request("https://board.example/api/prefs", { headers: { cookie } }), env, NOW)).json()) as { prefs: unknown };
    expect(got.prefs).toEqual({ version: 1, calendar: { fixedAlarm: 60, deadlineAlarm: null, emailReminders: true }, timeZones: { home: null, job: null }, deviceZone: null });
    expect((await handleApi(new Request("https://board.example/api/prefs"), env, NOW)).status).toBe(401);
  });
});

/**
 * 日历口令不能由看板密码算出来（2026-11-14 审查）。
 *
 * 订阅链接要交给 Google / 苹果的日历服务，它一旦泄露，「由密码算出来」就等于给了别人一个
 * 可以离线反复试密码的靶子；没设 SESSION_SECRET 时，这个密码还是所有登录凭据的签名钥匙。
 */
describe("日历口令和看板密码无关", () => {
  it("新建的作者账号：口令是随机的；由密码算出来的那条链接打不开", async () => {
    const fake = await setup();
    const derived = await calendarToken(PASSWORD);
    expect(ownerToken(fake)).not.toBe(derived);
    expect(ownerToken(fake)).toMatch(/^[0-9a-f]{40}$/);
    expect((await handleCalendar(new Request(`https://board.example/cal/${derived}.ics`), fake.env, NOW)).status).toBe(404);
  });

  it("老账号还在用由密码算出来的口令：链接照常能用，看板标出来；换新链接后不再标，旧链接 404", async () => {
    const fake = await setup();
    const { env } = fake;
    const derived = await calendarToken(PASSWORD);
    fake.exec("UPDATE users SET calendar_token = ? WHERE role = 'owner'", derived);
    const login = await handleApi(new Request("https://board.example/api/login", { method: "POST", body: JSON.stringify({ password: PASSWORD }), headers: { "cf-connecting-ip": "1.1.1.1" } }), env, NOW);
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
    const get = async () => (await (await handleApi(new Request("https://board.example/api/calendar", { headers: { cookie } }), env, NOW)).json()) as { url: string; derivedFromPassword: boolean };

    // 不替你换：换了已订阅的日历会悄悄停止更新，提醒就没了
    const before = await get();
    expect(before.url).toContain(derived);
    expect(before.derivedFromPassword).toBe(true);
    expect((await handleCalendar(new Request(before.url), env, NOW)).status).toBe(200);

    const reset = (await (await handleApi(new Request("https://board.example/api/calendar/reset", { method: "POST", headers: { cookie } }), env, NOW)).json()) as { url: string; derivedFromPassword: boolean };
    expect(reset.derivedFromPassword).toBe(false);
    expect((await get()).derivedFromPassword).toBe(false);
    expect((await handleCalendar(new Request(`https://board.example/cal/${derived}.ics`), env, NOW)).status).toBe(404);
  });

  it("没设看板密码：谈不上由密码推导", async () => {
    const fake = await setup();
    const { BOARD_PASSWORD: _unset, ...rest } = fake.env;
    const env: Env & { SESSION_SECRET: string } = { ...rest, SESSION_SECRET: "s".repeat(32) };
    const { issueSession } = await import("../src/auth.js");
    const ownerId = fake.all<{ id: string }>("SELECT id FROM users WHERE role = 'owner'")[0]!.id;
    const session = await issueSession(env.SESSION_SECRET, ownerId, NOW);
    const res = await handleApi(new Request("https://board.example/api/calendar", { headers: { cookie: `it_session=${session.value}` } }), env, NOW);
    expect(((await res.json()) as { derivedFromPassword: boolean }).derivedFromPassword).toBe(false);
  });
});
