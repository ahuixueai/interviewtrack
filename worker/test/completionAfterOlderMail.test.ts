import { describe, expect, it } from "vitest";
import { loadAgenda } from "../src/agendaData.js";
import { handleApi } from "../src/api.js";
import type { Env } from "../src/types.js";
import { toLiveData } from "../../web/lib/demo/liveData";
import type { EmailRow } from "../../web/lib/demo/liveData";
import type { AgendaItem } from "../../web/lib/demo/agenda";
import { complete, EMPTY_EDITS, parseEdits, uncomplete } from "../../web/lib/demo/userEdits";
import type { UserEdits } from "../../web/lib/demo/userEdits";
import { buildBoardData } from "../../web/lib/demo/view";
import { owner } from "./helpers.js";
import { testDb } from "./testDb.js";

/**
 * 标了完成之后，又进来一封「同一件事、原信时间更早」的信（导入旧邮件、作为附件转发的原信），
 * 完成状态不能丢（2026-11-14 审查发现）。
 *
 * 原因：一件事的 id 取它最早那封信的 id，你的决定都记在这个 id 上。
 * 更早的信一来，「最早那封」换了，id 跟着变，原来记下的完成就对不上了。
 *
 * 走的是看板实际的路：/api/import 入库 → /api/emails + /api/edits 读回 → toLiveData → buildBoardData。
 * 邮件全部是合成的。
 */

const NOW = Date.parse("2026-10-12T04:00:00Z");
const PASSWORD = "test-board-password";
const VIEWER = "America/New_York";

function env(): Env {
  return { DB: testDb().db, BOARD_PASSWORD: PASSWORD, OWNER_EMAIL: "owner@example.com", INBOX_DOMAIN: "my.example" };
}

function req(path: string, init: RequestInit & { cookie?: string } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  headers.set("cf-connecting-ip", "203.0.113.7");
  return new Request(`https://board.example${path}`, { ...init, headers });
}

async function login(e: Env): Promise<string> {
  const res = await handleApi(req("/api/login", { method: "POST", body: JSON.stringify({ password: PASSWORD }) }), e, NOW);
  expect(res.status).toBe(200);
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}

const EXAM = "同学你好，\n考试时间：10月20日 19:00-20:40（北京时间）\n考试码：XHKJ-7Q4M";
/** 先到看板的那封：10/11 发的。 */
const LATER = { from: "星河科技校园招聘 <campus@xinghe.example>", subject: "【星河科技】在线笔试通知（补发）", body: EXAM, receivedAtUtc: "2026-10-11T03:00:00Z" };
/** 后导入、但原信时间更早的那封：10/09 发的，说的是同一场笔试。 */
const EARLIER = { from: "星河科技校园招聘 <campus@xinghe.example>", subject: "【星河科技】在线笔试通知", body: EXAM, receivedAtUtc: "2026-10-09T03:00:00Z" };

async function importMail(e: Env, cookie: string, item: typeof LATER): Promise<void> {
  const res = await handleApi(req("/api/import", { method: "POST", cookie, body: JSON.stringify(item) }), e, NOW);
  expect(await res.json()).toEqual({ kind: "stored", status: "parsed" });
}

/** 打开（或刷新）看板：和 worker/board/src/App.tsx 读数据、算日程的步骤一样。 */
async function openBoard(e: Env, cookie: string): Promise<{ edits: UserEdits; events: AgendaItem[] }> {
  const emails = (await (await handleApi(req("/api/emails", { cookie }), e, NOW)).json()) as { emails: EmailRow[] };
  const saved = (await (await handleApi(req("/api/edits", { cookie }), e, NOW)).json()) as { edits: unknown };
  const edits = saved.edits === null ? EMPTY_EDITS : parseEdits(saved.edits);
  const live = toLiveData(emails.emails, VIEWER);
  const board = buildBoardData(live.samples, live.results, edits, NOW, VIEWER);
  return { edits, events: board.agenda.filter((item) => item.origin === "email" && item.place !== "ignored") };
}

async function save(e: Env, cookie: string, edits: UserEdits): Promise<void> {
  const res = await handleApi(req("/api/edits", { method: "PUT", cookie, body: JSON.stringify(edits) }), e, NOW);
  expect(res.status).toBe(200);
}

describe("标了完成之后，又进来一封更早的同事件邮件", () => {
  it("仍然只有一件事，而且仍然是已完成（看板和日历订阅两边都是）", async () => {
    const e = env();
    const cookie = await login(e);

    // 1. 一封信进来，看板上有了这件事
    await importMail(e, cookie, LATER);
    const first = await openBoard(e, cookie);
    expect(first.events).toHaveLength(1);
    expect(first.events[0]!.completion).toBeNull();

    // 2. 标完成并保存
    await save(e, cookie, complete(first.edits, first.events[0]!.id, "done", NOW));
    expect((await openBoard(e, cookie)).events[0]!.completion?.state).toBe("done");

    // 3. 导入一封原信时间更早、说的是同一场笔试的信
    await importMail(e, cookie, EARLIER);

    // 4. 刷新看板
    const after = await openBoard(e, cookie);
    expect(after.events).toHaveLength(1);
    expect(after.events[0]!.sources).toHaveLength(2);
    expect(after.events[0]!.completion?.state).toBe("done");

    // 日历订阅、邮件提醒用的服务端日程也一样
    const me = await owner(e);
    const server = (await loadAgenda(e, me.id)).agenda.filter((item) => item.origin === "email" && item.place !== "ignored");
    expect(server).toHaveLength(1);
    expect(server[0]!.completion?.state).toBe("done");
  });

  it("之后还能撤销完成：撤销后刷新，不再是已完成", async () => {
    const e = env();
    const cookie = await login(e);
    await importMail(e, cookie, LATER);
    const first = await openBoard(e, cookie);
    await save(e, cookie, complete(first.edits, first.events[0]!.id, "done", NOW));
    await importMail(e, cookie, EARLIER);

    const after = await openBoard(e, cookie);
    await save(e, cookie, uncomplete(after.edits, after.events[0]!.id));
    const undone = await openBoard(e, cookie);
    expect(undone.events).toHaveLength(1);
    expect(undone.events[0]!.completion).toBeNull();
  });

  it("先来的是更早那封时本来就没事：这条保证修复没有改变正常顺序下的行为", async () => {
    const e = env();
    const cookie = await login(e);
    await importMail(e, cookie, EARLIER);
    const first = await openBoard(e, cookie);
    await save(e, cookie, complete(first.edits, first.events[0]!.id, "done", NOW));
    await importMail(e, cookie, LATER);
    const after = await openBoard(e, cookie);
    expect(after.events).toHaveLength(1);
    expect(after.events[0]!.id).toBe(first.events[0]!.id);
    expect(after.events[0]!.completion?.state).toBe("done");
  });
});
