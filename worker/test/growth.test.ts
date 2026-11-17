import { describe, expect, it } from "vitest";
import { handleApi } from "../src/api.js";
import type { ApiDeps } from "../src/api.js";
import { cleanSignup } from "../src/growth.js";
import { touchLastSeen } from "../src/stats.js";
import type { Env } from "../src/types.js";
import { readFromLocation } from "../board/src/attribution.js";
import { testDb } from "./testDb.js";

const NOW = Date.parse("2026-10-20T12:00:00Z");

function setup() {
  const fake = testDb();
  const env: Env = { DB: fake.db, SESSION_SECRET: "sess", OWNER_EMAIL: "owner@example.com", TURNSTILE_SECRET: "ts", INBOX_DOMAIN: "my.example" };
  const sent: { to: string; code: string }[] = [];
  const deps: ApiDeps = {
    checkTurnstile: () => Promise.resolve(true),
    sendCode: (to, code) => {
      sent.push({ to, code });
      return Promise.resolve();
    },
  };
  const call = (path: string, body?: unknown, opts: { cookie?: string; method?: string } = {}) =>
    handleApi(
      new Request(`https://board.my.example${path}`, {
        method: opts.method ?? (body === undefined ? "GET" : "POST"),
        headers: { "cf-connecting-ip": "203.0.113.5", ...(opts.cookie ? { cookie: opts.cookie } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      NOW,
      deps,
    );
  const signUp = async (email: string, source?: unknown) => {
    await call("/api/auth/code", { email, turnstile: "human" });
    const code = sent.filter((s) => s.to === email).at(-1)!.code;
    const res = await call("/api/auth/verify", { email, code, source });
    return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  };
  const askSource = async (cookie: string) => ((await (await call("/api/session", undefined, { cookie })).json()) as { askSource: boolean }).askSource;
  return { ...fake, env, call, signUp, askSource };
}

describe("新用户从哪来", () => {
  it("链接带了渠道：注册时记下，不再问；只记注册那一次", async () => {
    const t = setup();
    const cookie = await t.signUp("a@x.example", { channel: "xhs", campaign: "1019-八图", referrer: null });
    expect(t.all("SELECT signup_channel, signup_campaign, plan FROM users WHERE email = 'a@x.example'")).toEqual([
      { signup_channel: "xhs", signup_campaign: "1019-八图", plan: "free" },
    ]);
    expect(await t.askSource(cookie)).toBe(false);
    // 老账号再登录，带了别的来源也不改
    await t.signUp("a@x.example", { channel: "github" });
    expect(t.all("SELECT signup_channel FROM users WHERE email = 'a@x.example'")).toEqual([{ signup_channel: "xhs" }]);
  });

  it("没认出来源：问一次；答了（或跳过）就不再问；乱答的不收", async () => {
    const t = setup();
    const cookie = await t.signUp("b@x.example", { referrer: "board.my.example" });
    expect(t.all("SELECT signup_referrer FROM users WHERE email = 'b@x.example'")).toEqual([{ signup_referrer: null }]);
    expect(await t.askSource(cookie)).toBe(true);
    expect((await t.call("/api/account/source", { answer: "hack" }, { cookie, method: "PUT" })).status).toBe(400);
    expect((await t.call("/api/account/source", { answer: "friend" }, { cookie, method: "PUT" })).status).toBe(200);
    expect(await t.askSource(cookie)).toBe(false);
    await t.call("/api/account/source", { answer: "xhs" }, { cookie, method: "PUT" });
    expect(t.all("SELECT signup_answer FROM users WHERE email = 'b@x.example'")).toEqual([{ signup_answer: "friend" }]);
  });

  it("作者不问", async () => {
    const t = setup();
    expect(await t.askSource(await t.signUp("owner@example.com"))).toBe(false);
  });

  it("格式不对的来源丢掉，不挡注册", () => {
    expect(cleanSignup({ channel: "XHS", campaign: "a b<script>", referrer: "www.Google.com" }, "my.example")).toEqual({ channel: "xhs", campaign: "abscript", referrer: "google.com" });
    expect(cleanSignup({ channel: "x".repeat(40), referrer: "not a domain" }, "my.example")).toEqual({ channel: null, campaign: null, referrer: null });
    expect(cleanSignup("junk", "my.example")).toEqual({ channel: null, campaign: null, referrer: null });
  });

  it("每天第一次打开记一次（看留存）；跨了零点也算新的一天", async () => {
    const t = setup();
    t.exec("INSERT INTO users (id, email, role, created_at) VALUES ('u', 'u@x.example', 'member', '2026-10-01T00:00:00Z')");
    const late = Date.parse("2026-10-20T23:40:00Z");
    await touchLastSeen(t.env, "u", late);
    await touchLastSeen(t.env, "u", late + 5 * 60_000);
    await touchLastSeen(t.env, "u", late + 30 * 60_000);
    expect(t.all("SELECT day, n FROM daily_stats WHERE metric = 'open' ORDER BY day")).toEqual([
      { day: "2026-10-20", n: 1 },
      { day: "2026-10-21", n: 1 },
    ]);
  });
});

describe("看板这一侧：从地址认来源", () => {
  it("?from= 和 ?c=：记下，地址栏去掉标记", () => {
    expect(readFromLocation("https://board.my.example/?from=zhihu&c=post1&x=1", "")).toEqual({
      found: { channel: "zhihu", campaign: "post1", referrer: null },
      cleanPath: "/?x=1",
    });
  });
  it("短网址 /xhs：认出小红书，地址栏回到首页；不认识的路径不当渠道", () => {
    expect(readFromLocation("https://board.my.example/xhs", "")).toEqual({ found: { channel: "xhs", campaign: null, referrer: null }, cleanPath: "/" });
    expect(readFromLocation("https://board.my.example/privacy", "")).toEqual({ found: null, cleanPath: null });
  });
  it("从别的网站点进来：记域名；自己网站内部跳转不算", () => {
    expect(readFromLocation("https://board.my.example/", "https://www.google.com/search?q=x").found).toEqual({ channel: null, campaign: null, referrer: "google.com" });
    expect(readFromLocation("https://board.my.example/", "https://my.example/").found).toBeNull();
  });
});
