import { describe, expect, it } from "vitest";
import { requestCode } from "../src/accounts.js";
import { findProblems } from "../src/monitor.js";
import { deleteUserData } from "../src/privacy.js";
import { pruneStats, recordAdmission, recordHandling, sendsToday, sourceOf, touchLastSeen } from "../src/stats.js";
import { member, owner, setup } from "./helpers.js";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const HOUR = 3_600_000;

describe("后台统计：哪家邮箱转来的", () => {
  it("按信封发件人的域名认；QQ、网易自动转发带的 +标记 / auto_ 前缀不影响", () => {
    expect(sourceOf("someone@gmail.com")).toBe("gmail");
    expect(sourceOf("10001+auto_=u-abc@qq.com")).toBe("qq");
    expect(sourceOf("x@foxmail.com")).toBe("qq");
    expect(sourceOf("auto_alice+u-abc@163.com")).toBe("netease");
    expect(sourceOf("a@126.com")).toBe("netease");
    expect(sourceOf("a@outlook.com")).toBe("outlook");
    expect(sourceOf("a@hotmail.co.uk")).toBe("outlook");
    expect(sourceOf("a@mail.school.edu")).toBe("other");
    expect(sourceOf("")).toBe("");
  });
});

describe("后台统计：记次数", () => {
  it("收到一封记一次；一次转发好几封的，拆出来的逐封记结果", async () => {
    const t = setup();
    const me = await owner(t.e);
    await recordHandling(t.e, NOW, me.id, "a@qq.com", {
      kind: "split",
      results: [{ kind: "stored", status: "parsed" }, { kind: "stored", status: "parsed" }, { kind: "duplicate" }],
    });
    await recordHandling(t.e, NOW, me.id, "a@qq.com", { kind: "skipped" });
    await recordHandling(t.e, NOW, null, "spam@x.example", { kind: "rejected", reason: "没有这个收信地址" });
    const rows = t.all<{ user_id: string; metric: string; source: string; n: number }>("SELECT user_id, metric, source, n FROM daily_stats ORDER BY user_id, metric");
    expect(rows).toEqual([
      { user_id: "", metric: "mail_in", source: "other", n: 1 },
      { user_id: "", metric: "rejected", source: "other", n: 1 },
      { user_id: me.id, metric: "duplicate", source: "qq", n: 1 },
      { user_id: me.id, metric: "mail_in", source: "qq", n: 2 },
      { user_id: me.id, metric: "parsed", source: "qq", n: 2 },
      { user_id: me.id, metric: "skipped", source: "qq", n: 1 },
    ]);
  });

  it("验证码：发出去记一次、发失败另记；今天的发信量合计", async () => {
    let fail = false;
    const t = setup({ REGISTRATION: "open", SESSION_SECRET: "s" });
    const send = async () => {
      if (fail) throw new Error("quota");
    };
    await requestCode(t.e, "new@x.example", "203.0.113.1", NOW, send);
    fail = true;
    await expect(requestCode(t.e, "other@x.example", "203.0.113.1", NOW, send)).rejects.toThrow();
    const rows = t.all<{ metric: string; n: number }>("SELECT metric, n FROM daily_stats ORDER BY metric");
    expect(rows).toEqual([
      { metric: "login_code", n: 1 },
      { metric: "login_code_failed", n: 1 },
    ]);
    expect(await sendsToday(t.e, NOW)).toBe(1);
  });

  it("最近一次打开看板：一小时内不重复写", async () => {
    const t = setup();
    const me = await owner(t.e);
    const seen = () => t.all<{ last_seen_at: string }>("SELECT last_seen_at FROM users WHERE id = ?", me.id)[0]?.last_seen_at;
    await touchLastSeen(t.e, me.id, NOW);
    expect(seen()).toBe(new Date(NOW).toISOString());
    await touchLastSeen(t.e, me.id, NOW + 30 * 60_000);
    expect(seen()).toBe(new Date(NOW).toISOString());
    await touchLastSeen(t.e, me.id, NOW + 2 * HOUR);
    expect(seen()).toBe(new Date(NOW + 2 * HOUR).toISOString());
  });

  it("删账号时一起删；90 天前的自动删", async () => {
    const t = setup();
    const me = await owner(t.e);
    const other = await member(t.e, "o@x.example");
    await recordHandling(t.e, NOW, other.id, "o@gmail.com", { kind: "stored", status: "parsed" });
    await recordHandling(t.e, NOW - 100 * 24 * HOUR, me.id, "a@gmail.com", { kind: "stored", status: "parsed" });
    await recordHandling(t.e, NOW, me.id, "a@gmail.com", { kind: "stored", status: "parsed" });
    await deleteUserData(t.e, other);
    await pruneStats(t.e, NOW);
    expect(t.all<{ user_id: string; day: string }>("SELECT DISTINCT user_id, day FROM daily_stats")).toEqual([{ user_id: me.id, day: "2026-10-20" }]);
  });
});

describe("监控：名额、发信量", () => {
  it("账号到了上限的 80%：提醒", async () => {
    const t = setup({ MAX_USERS: "5" });
    await owner(t.e);
    for (const e of ["a", "b"]) await member(t.e, `${e}@x.example`);
    expect((await findProblems(t.e, NOW)).map((p) => p.key)).not.toContain("seats");
    await member(t.e, "c@x.example");
    expect((await findProblems(t.e, NOW)).map((p) => p.key)).toContain("seats");
  });

  it("填了每日发信上限：今天发到 80% 提醒；没填不查", async () => {
    const t = setup();
    await owner(t.e);
    t.exec("INSERT INTO daily_stats (day, user_id, metric, source, n) VALUES ('2026-10-20', '', 'reminder_mail', '', 70), ('2026-10-20', '', 'login_code', '', 10)");
    expect((await findProblems(t.e, NOW)).map((p) => p.key)).not.toContain("sends");
    expect((await findProblems({ ...t.e, SEND_DAILY_LIMIT: "100" }, NOW)).map((p) => p.key)).toContain("sends");
    expect((await findProblems({ ...t.e, SEND_DAILY_LIMIT: "200" }, NOW)).map((p) => p.key)).not.toContain("sends");
  });
});

describe("后台统计：被接收的信是凭什么被接收的", () => {
  it("同一种形状累加；没被接收（null）或认不出是谁的不记", async () => {
    const t = setup();
    const me = await owner(t.e);
    const shape = "xff|env:caf|auth:cf|spf:pass|dkim:pass|dmarc:pass";
    await recordAdmission(t.e, NOW, me.id, shape);
    await recordAdmission(t.e, NOW, me.id, shape);
    await recordAdmission(t.e, NOW, me.id, "xff|env:other|auth:none|spf:-|dkim:-|dmarc:-");
    await recordAdmission(t.e, NOW, me.id, null);
    await recordAdmission(t.e, NOW, null, shape);
    expect(t.all("SELECT source, n FROM daily_stats WHERE metric = 'admit' ORDER BY source")).toEqual([
      { source: shape, n: 2 },
      { source: "xff|env:other|auth:none|spf:-|dkim:-|dmarc:-", n: 1 },
    ]);
  });
});
