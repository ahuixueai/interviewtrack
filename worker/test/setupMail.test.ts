import { describe, expect, it } from "vitest";
import { sendSetupMail, SETUP_MAILS_PER_DAY } from "../src/setupMail.js";
import type { OutgoingEmail } from "../src/types.js";
import { member, setup } from "./helpers.js";

const NOW = Date.parse("2026-10-20T12:00:00Z");

describe("把设置步骤发到我邮箱", () => {
  it("发到登录邮箱，信里是带 ?setup= 的链接和收信地址；记一次发信", async () => {
    const sent: OutgoingEmail[] = [];
    const t = setup({ LOGIN_FROM: "login@my.example", EMAIL: { send: async (m) => (sent.push(m), { messageId: "x" }) } });
    const u = await member(t.e, "a@qq.example");
    const r = await sendSetupMail(t.e, u, "qq", "https://board.my.example", NOW);
    expect(r).toEqual({ ok: true, to: "a@qq.example" });
    expect(sent[0]?.to).toBe("a@qq.example");
    expect(sent[0]?.text).toContain("https://board.my.example/?setup=qq");
    expect(sent[0]?.text).toContain(`u-${u.inbox_token}@my.example`);
    expect(t.all("SELECT metric, n FROM daily_stats WHERE user_id = ?", u.id)).toEqual([{ metric: "setup_mail", n: 1 }]);
  });

  it("不认识的邮箱不发；一天最多 3 封", async () => {
    const t = setup({ EMAIL: { send: async () => ({ messageId: "x" }) } });
    const u = await member(t.e, "b@x.example");
    expect(await sendSetupMail(t.e, u, "yahoo", "https://b", NOW)).toMatchObject({ ok: false, status: 400 });
    for (let i = 0; i < SETUP_MAILS_PER_DAY; i++) expect((await sendSetupMail(t.e, u, "gmail", "https://b", NOW)).ok).toBe(true);
    expect(await sendSetupMail(t.e, u, "gmail", "https://b", NOW)).toMatchObject({ ok: false, status: 429 });
    expect((await sendSetupMail(t.e, u, "gmail", "https://b", NOW + 86_400_000)).ok).toBe(true);
  });
});
