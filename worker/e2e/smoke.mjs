#!/usr/bin/env node
/**
 * 看板冒烟测试：用真浏览器把最常走的那条路走一遍。
 *
 *   登录 → 首次设置 → 两封信进来 → 待确认里「放进日程」→ 标完成 → 刷新后都还在
 *   → 另一个页面拿着旧数据再保存：被拦下并提示，先存的那份没丢
 *
 * 单元测试管不到的东西在这里：按钮点了有没有反应、保存有没有真的发出去、刷新后页面认不认。
 * 全部是合成邮件，每次用一个新的测试账号，不碰真实数据。
 *
 * 怎么跑（两个终端，都在 worker 目录）：
 *   终端 1：  npm run e2e:serve      本地起收信程序 + 看板（本地数据库，不连线上）
 *   终端 2：  npm run e2e            跑这个脚本
 *
 * 只能对着本地开发模式跑：它靠「验证码直接显示在页面上」登录，线上没有这个模式，脚本会直接退出。
 */
import { createRequire } from "node:module";

const BASE = process.env.BOARD_URL ?? "http://127.0.0.1:8787";
// playwright 装在 web/ 下（那边的旧 e2e 也用它）；PW_FROM 可以指到别处装的那份
const { chromium } = createRequire(process.env.PW_FROM ?? new URL("../../web/", import.meta.url))("playwright");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : `  ← ${detail}`}`);
};

const config = await fetch(`${BASE}/api/auth/config`).then((r) => r.json()).catch(() => null);
if (config === null) {
  console.error(`连不上 ${BASE}：先在另一个终端运行 npm run e2e:serve`);
  process.exit(2);
}
if (config.devMode !== true) {
  console.error("这不是本地开发模式（没有 DEV_INSECURE_AUTH=1，或配了 TURNSTILE_SECRET）。冒烟测试只对着本地跑，不对着线上跑。");
  process.exit(2);
}

// --no-proxy-server：有的环境给浏览器配了代理，本机地址不该走代理
const browser = await chromium.launch({ args: ["--no-proxy-server"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "zh-CN" });
const errors = [];
const watch = (page, label) => page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));

const tabCount = async (page, tab) => {
  const text = await page.locator(`[data-view-tab="${tab}"]`).innerText();
  const n = /(\d+)\s*$/.exec(text.trim());
  return n ? Number(n[1]) : 0;
};
const go = async (page, tab) => {
  await page.click(`[data-view-tab="${tab}"]`);
  await page.waitForSelector(`[data-view="${tab}"]`);
};
const card = (page, company) => page.locator("[data-event-card]", { hasText: company });
const saved = (page) => page.getByText("已保存到云端").waitFor({ timeout: 10_000 });
const serverEdits = (page) => page.evaluate(async () => (await (await fetch("/api/edits")).json()).edits);

try {
  // ---------- 1. 登录 ----------
  const page = await context.newPage();
  watch(page, "页面 1");
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.fill('form[data-login] input[type="email"]', `smoke-${Date.now()}@example.com`);
  await page.click('[data-action="send-code"]');
  await page.waitForSelector('form[data-login="code"]');
  const code = (await page.locator("form[data-login] .font-mono").first().innerText()).trim();
  await page.locator("form[data-login] input").first().fill(code);
  await page.click('[data-action="verify-code"]');

  // ---------- 2. 首次设置 ----------
  await page.click('[data-action="save-zones"]');
  await page.waitForSelector("[data-view-tab]");
  check("登录并完成首次设置，看到看板", true);

  // ---------- 3. 两封信进来 ----------
  const day = new Date(Date.now() + 9 * 86_400_000);
  const when = `${day.getUTCMonth() + 1}月${day.getUTCDate()}日`;
  const importMail = (item) =>
    page.evaluate(async (m) => (await fetch("/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(m) })).json(), item);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  const a = await importMail({ from: "北辰科技招聘 <hr@beichen.example>", subject: "【北辰科技】面试邀请", body: "林同学你好，诚邀你参加市场运营岗位的面试，请回复你方便的时间。", receivedAtUtc: yesterday });
  const b = await importMail({ from: "星河科技校园招聘 <campus@xinghe.example>", subject: "【星河科技】在线笔试通知", body: `同学你好，\n考试时间：${when} 19:00-20:40（北京时间）\n考试码：XHKJ-7Q4M`, receivedAtUtc: yesterday });
  check("两封合成邮件入库并解析", a.status === "parsed" && b.status === "parsed", JSON.stringify([a, b]));

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-view-tab]");
  check("写了时间的笔试自动进日程，没写时间的面试进待确认", (await tabCount(page, "agenda")) === 1 && (await tabCount(page, "pending")) === 1, `日程 ${await tabCount(page, "agenda")} · 待确认 ${await tabCount(page, "pending")}`);

  // ---------- 4. 待确认 → 放进日程 ----------
  await go(page, "pending");
  await card(page, "北辰科技").locator('[data-action="confirm"]').click();
  await page.locator('form input[name="timeKind"][value="none"]').check();
  await page.locator('form button[type="submit"]').click();
  await saved(page);
  check("在待确认里点「放进日程」并保存", (await tabCount(page, "pending")) === 0 && (await tabCount(page, "agenda")) === 2, `日程 ${await tabCount(page, "agenda")} · 待确认 ${await tabCount(page, "pending")}`);

  // ---------- 5. 标完成 ----------
  await go(page, "agenda");
  await card(page, "星河科技").locator('[data-action="complete"]').first().click();
  await saved(page);
  const afterDone = await serverEdits(page);
  const doneIds = Object.keys(afterDone?.completions ?? {});
  check("把笔试标成完成，云端存下了", doneIds.length === 1 && afterDone.completions[doneIds[0]].state === "done", JSON.stringify(afterDone?.completions));

  // ---------- 6. 刷新 ----------
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-view-tab]");
  await go(page, "agenda");
  const doneGroup = page.locator('[data-agenda-group="done"]');
  check("刷新后：待确认仍是 0，北辰科技仍在日程上", (await tabCount(page, "pending")) === 0 && (await card(page, "北辰科技").count()) >= 1);
  check("刷新后：星河科技仍在「已完成」里", (await doneGroup.count()) === 1 && /1/.test(await doneGroup.innerText()), (await doneGroup.count()) === 1 ? (await doneGroup.innerText()).replace(/\s+/g, " ").slice(0, 60) : "没有已完成这一组");

  // ---------- 7. 两个页面：后存的那个拿着旧数据 ----------
  const stale = await context.newPage();
  watch(stale, "页面 2");
  await stale.goto(BASE, { waitUntil: "domcontentloaded" });
  await stale.waitForSelector("[data-view-tab]");
  await go(stale, "agenda"); // 页面 2 此时看到的和云端一致

  // 页面 1 先改：把北辰科技也标完成
  await card(page, "北辰科技").locator('[data-action="complete"]').first().click();
  await saved(page);
  const mine = await serverEdits(page);
  check("页面 1 又标完成一件，云端现在有两条完成", Object.keys(mine?.completions ?? {}).length === 2);

  // 页面 2 还不知道，把北辰科技移出日程 —— 以前这一下会整份覆盖，把页面 1 刚标的完成抹掉
  await card(stale, "北辰科技").locator('[data-action="remove"]').first().click();
  await stale.getByText("别处").first().waitFor({ timeout: 10_000 }).catch(() => {});
  const hint = (await stale.locator('[role="alert"]').allInnerTexts()).join(" ");
  check("页面 2 拿着旧数据保存：被拦下，并提示「别处刚改过」", /别处/.test(hint), hint.slice(0, 80) || "没有出现提示");
  const theirs = await serverEdits(stale);
  check("云端仍是页面 1 存的那份：两条完成都在", JSON.stringify(theirs) === JSON.stringify(mine));
  check("页面 2 换成了最新的：北辰科技显示为已完成", (await stale.locator('[data-agenda-group="done"]').count()) === 1 && /2/.test(await stale.locator('[data-agenda-group="done"]').innerText()));

  check("全程页面没有报错", errors.length === 0, errors.join("；"));
} catch (error) {
  check("脚本中途出错", false, String(error?.message ?? error).split("\n")[0]);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `\n冒烟测试通过：${results.length} 项` : `\n冒烟测试没过：${failed.length} / ${results.length} 项失败`);
process.exit(failed.length === 0 ? 0 : 1);
