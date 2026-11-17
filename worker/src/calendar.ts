import { buildIcs } from "../../web/lib/demo/calendar";
import { userByCalendarToken } from "./accounts.js";
import { loadAgenda } from "./agendaData.js";
import { bump } from "./stats.js";
import type { Env } from "./types.js";

/**
 * 日历订阅：GET /cal/<口令>.ics
 *
 * 日历程序（Google、苹果）不会登录，所以靠链接里的口令认人。每人一把口令，存在 users 表里，和登录无关；
 * 链接泄露了就在设置里「换一个新链接」，旧链接立刻失效。
 * 口令都是随机的。早先建的作者账号用的是「由看板密码算出来」的那把（calendarToken）：
 * 不替你换（换了已订阅的日历会悄悄停止更新），但看板会标出来，请你自己点一次「换一个新链接」。
 * 内容和看板「日程」用的是同一个函数算出来的（agendaData.ts），不会两边对不上。
 */

const encoder = new TextEncoder();

/** 以前「由看板密码算出来」的日历口令。现在只用来认出还在用它的老账号，不再用来生成口令。 */
export async function calendarToken(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode("calendar-feed-v1"));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

/** 这把口令是不是由现在的看板密码算出来的那把（老账号才会是）。是的话该换。 */
export async function derivedFromPassword(env: Env, token: string | null): Promise<boolean> {
  const password = env.BOARD_PASSWORD ?? "";
  if (token === null || password.length === 0) return false;
  return token === (await calendarToken(password));
}

export async function handleCalendar(request: Request, env: Env, nowMs: number): Promise<Response> {
  const notFound = () => new Response("没有这个日历", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const match = /^\/cal\/([0-9a-f]{40})\.ics$/.exec(new URL(request.url).pathname);
  if (!match) return notFound();
  const user = await userByCalendarToken(env, match[1] ?? "");
  if (user === null) return notFound();

  const { agenda, prefs } = await loadAgenda(env, user.id);
  // 日历程序来取了一次（每隔几小时一次）：后台用它看有多少人在用日历订阅
  await bump(env, nowMs, user.id, "use_calendar");
  const origin = new URL(request.url).origin;
  return new Response(buildIcs(agenda, nowMs, origin, prefs.calendar), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "private, max-age=300",
    },
  });
}
