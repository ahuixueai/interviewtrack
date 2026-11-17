import { describe, expect, it } from "vitest";
import { handleApi } from "../src/api.js";
import type { Env } from "../src/types.js";
import { testDb } from "./testDb.js";

/**
 * 两台设备（或两个标签页）同时开着看板时，后保存的不能悄悄盖掉先保存的（2026-11-14 审查）。
 *
 * 以前 PUT /api/edits 是整份覆盖、不看版本：手机上标了完成，电脑上那个早就打开的页面再存一次，
 * 手机上的完成就没了，谁也不知道。
 *
 * 现在：读的时候给一个版本号（内容的指纹），存的时候带上「我是在哪个版本上改的」。
 * 对不上就拒绝（409），把云端现在那份还给页面。不带版本号的老页面照旧能存，不会被锁在外面。
 */

const NOW = Date.parse("2026-10-12T04:00:00Z");
const PASSWORD = "test-board-password";

function env(): Env {
  return { DB: testDb().db, BOARD_PASSWORD: PASSWORD, OWNER_EMAIL: "owner@example.com", INBOX_DOMAIN: "my.example" };
}
function req(path: string, init: RequestInit & { cookie?: string; base?: string } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.base !== undefined) headers.set("x-edits-base", init.base);
  headers.set("cf-connecting-ip", "203.0.113.7");
  return new Request(`https://board.example${path}`, { ...init, headers });
}
async function login(e: Env): Promise<string> {
  const res = await handleApi(req("/api/login", { method: "POST", body: JSON.stringify({ password: PASSWORD }) }), e, NOW);
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}
const read = async (e: Env, cookie: string) => (await (await handleApi(req("/api/edits", { cookie }), e, NOW)).json()) as { edits: unknown; version: string };
const write = (e: Env, cookie: string, edits: unknown, base?: string) =>
  handleApi(req("/api/edits", { method: "PUT", cookie, body: JSON.stringify(edits), ...(base === undefined ? {} : { base }) }), e, NOW);

const DONE_ON_PHONE = { version: 1, completions: { "mail-1": { state: "done", atMs: 1 } } };
const NOTE_ON_LAPTOP = { version: 1, itemEdits: { "mail-2": { note: "带简历" } } };

describe("保存时的版本校验", () => {
  it("读回来带版本号；按这个版本存，成功并拿到新版本号", async () => {
    const e = env();
    const cookie = await login(e);
    const empty = await read(e, cookie);
    expect(empty.edits).toBeNull();
    expect(empty.version).toBe("");

    const saved = await write(e, cookie, DONE_ON_PHONE, empty.version);
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as { ok: boolean; version: string };
    expect(body.version).toMatch(/^[0-9a-f]{16}$/);
    expect((await read(e, cookie)).version).toBe(body.version);
  });

  it("两台设备：后存的那台版本对不上 → 409，先存的那份还在，并且原样还给后存的那台", async () => {
    const e = env();
    const cookie = await login(e);
    // 手机和电脑同时打开，看到的是同一个版本
    const phone = await read(e, cookie);
    const laptop = await read(e, cookie);

    // 手机先标完成
    expect((await write(e, cookie, DONE_ON_PHONE, phone.version)).status).toBe(200);

    // 电脑还拿着旧版本，存一条备注
    const clash = await write(e, cookie, NOTE_ON_LAPTOP, laptop.version);
    expect(clash.status).toBe(409);
    const body = (await clash.json()) as { conflict: boolean; edits: unknown; version: string };
    expect(body.conflict).toBe(true);
    expect(body.edits).toEqual(DONE_ON_PHONE);

    // 云端仍是手机那份：完成没丢
    const now = await read(e, cookie);
    expect(now.edits).toEqual(DONE_ON_PHONE);
    expect(body.version).toBe(now.version);

    // 电脑拿到最新版本后重做那一步，两边的修改都在
    const merged = { version: 1, completions: DONE_ON_PHONE.completions, itemEdits: NOTE_ON_LAPTOP.itemEdits };
    expect((await write(e, cookie, merged, now.version)).status).toBe(200);
    expect((await read(e, cookie)).edits).toEqual(merged);
  });

  it("云端已经有东西，却声称「我是从空的开始改的」→ 409", async () => {
    const e = env();
    const cookie = await login(e);
    await write(e, cookie, DONE_ON_PHONE, "");
    expect((await write(e, cookie, NOTE_ON_LAPTOP, "")).status).toBe(409);
  });

  it("内容一样的重复保存不算冲突", async () => {
    const e = env();
    const cookie = await login(e);
    const first = (await (await write(e, cookie, DONE_ON_PHONE, "")).json()) as { version: string };
    const again = await write(e, cookie, DONE_ON_PHONE, first.version);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { version: string }).version).toBe(first.version);
  });

  it("不带版本号的老页面：照旧能存（升级那一刻还开着的页面不会突然存不了）", async () => {
    const e = env();
    const cookie = await login(e);
    await write(e, cookie, DONE_ON_PHONE, "");
    expect((await write(e, cookie, NOTE_ON_LAPTOP)).status).toBe(200);
    expect((await read(e, cookie)).edits).toEqual(NOTE_ON_LAPTOP);
  });
});
