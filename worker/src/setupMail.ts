import type { User } from "./accounts.js";
import { inboxAddress } from "./accounts.js";
import { systemSender } from "./inbox.js";
import { bump, statDay } from "./stats.js";
import type { Env } from "./types.js";

/**
 * 「把设置步骤发到我邮箱」（10/20）：在手机上打开的人设不了自动转发（Gmail、QQ、163、Outlook 的手机 App 都没有这个设置），
 * 给他的登录邮箱发一封信，里面是一个链接：在电脑上打开、登录后直接进到那家邮箱的设置步骤。
 * 步骤本身只在看板里写一份（ForwardSetup.tsx），信里不重复，免得两边对不上。
 * 每人每天最多 3 封（占用发信额度）。
 */

export const SETUP_PROVIDERS = ["gmail", "qq", "163", "outlook", "school", "other"] as const;
export type SetupProvider = (typeof SETUP_PROVIDERS)[number];
const LABEL: Record<SetupProvider, string> = { gmail: "Gmail", qq: "QQ 邮箱", "163": "163 / 126 邮箱", outlook: "Outlook", school: "学校邮箱", other: "你的邮箱" };
export const SETUP_MAILS_PER_DAY = 3;

export type SetupMailResult = { ok: true; to: string } | { ok: false; status: number; error: string };

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function sendSetupMail(env: Env, user: User, provider: unknown, origin: string, nowMs: number): Promise<SetupMailResult> {
  if (typeof provider !== "string" || !(SETUP_PROVIDERS as readonly string[]).includes(provider)) return { ok: false, status: 400, error: "格式不对" };
  if (!env.EMAIL) return { ok: false, status: 503, error: "发信还没配置好" };
  const sent = await env.DB.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM daily_stats WHERE day = ? AND user_id = ? AND metric = 'setup_mail'")
    .bind(statDay(nowMs), user.id)
    .first<{ n: number }>();
  if ((sent?.n ?? 0) >= SETUP_MAILS_PER_DAY) return { ok: false, status: 429, error: `今天已经发过 ${SETUP_MAILS_PER_DAY} 次了，去邮箱里找找（也看看垃圾邮件）` };

  const p = provider as SetupProvider;
  const link = `${origin}/?setup=${p}`;
  const inbox = inboxAddress(env, user);
  const subject = `在电脑上设置准点的自动转发（${LABEL[p]}，约 3 分钟）`;
  const lines = [
    `在电脑上打开下面这个链接，登录后会直接打开${LABEL[p]}的设置步骤：`,
    link,
    "",
    `你的准点收信地址（设置时要用到）：${inbox}`,
    "",
    "设好之前，也可以先在手机上把一封招聘邮件手动转发到这个地址，几分钟内就会出现在准点里。",
    "",
    "（这封信是你在准点里点「把步骤发到我邮箱」发出的。不是你本人操作的话，忽略即可。）",
  ];
  const html = `<div style="font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;font-size:14px;line-height:1.7;color:#14222f;max-width:560px">
<p>在电脑上打开下面这个链接，登录后会直接打开${escapeHtml(LABEL[p])}的设置步骤：</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#14222f;color:#fff;text-decoration:none;padding:8px 14px;border-radius:6px">在电脑上打开设置步骤</a></p>
<p style="color:#46586a">${escapeHtml(link)}</p>
<p>你的准点收信地址（设置时要用到）：<br><code style="font-size:15px">${escapeHtml(inbox)}</code></p>
<p>设好之前，也可以先在手机上把一封招聘邮件<strong>手动转发</strong>到这个地址，几分钟内就会出现在准点里。</p>
<p style="color:#5f7285;font-size:12px">这封信是你在准点里点「把步骤发到我邮箱」发出的。不是你本人操作的话，忽略即可。</p>
</div>`;
  await env.EMAIL.send({ from: { email: systemSender(env), name: "准点" }, to: user.email, subject, text: lines.join("\n"), html });
  await bump(env, nowMs, user.id, "setup_mail");
  return { ok: true, to: user.email };
}
