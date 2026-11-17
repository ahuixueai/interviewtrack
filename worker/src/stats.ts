import type { Handling } from "./inbox.js";
import type { Env } from "./types.js";

/**
 * 后台统计（10/20）：每天、每个人、每类事件发生了几次，记在 daily_stats。只记次数，不记内容。
 * 运营者在自己电脑上用只读查询看这些数（看板上没有后台入口；那个本地小工具不在这个仓库里）。
 *
 * 记数失败绝不影响收信和发信：所有写入都吞掉错误。
 */

export type Metric =
  /** 收到一封信（最外层那封；一次转发好几封的，拆出来的每封另记结果）。 */
  | "mail_in"
  /** 收信的结果：解析了 / 判定不是招聘信 / 处理出错 / 你自己写的 / 重复 / 转发确认信 / 不像招聘信丢掉 / 拒收 */
  | "parsed"
  | "dropped"
  | "error"
  | "self"
  | "duplicate"
  | "notice"
  | "skipped"
  | "rejected"
  /** 被接收的信是凭什么被接收的（11/16，只记录）：source 列放 mail.ts admissionEvidence 给的那串形状。 */
  | "admit"
  /** 发信：登录验证码、邮件提醒、监控提醒；以及发失败的。 */
  | "login_code"
  | "login_code_failed"
  | "reminder_mail"
  | "reminder_failed"
  | "alert_mail"
  /** 「把设置步骤发到我邮箱」（手机上设不了自动转发时）。 */
  | "setup_mail"
  /** 打开看板：每人每天最多记 1 次（看留存）。 */
  | "open"
  /** 功能使用（定价前最该看的数）：AI 面试准备、一句话添加、导入旧邮件、日历程序来取订阅。 */
  | "use_prepare"
  | "use_quick_add"
  | "use_import"
  | "use_calendar";

export type Source = "gmail" | "qq" | "netease" | "outlook" | "other" | "";

export const KEEP_STATS_DAYS = 90;

export function statDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** 信封发件人是哪家邮箱（自动转发、手动转发时信封发件人都是用户自己的邮箱）。 */
export function sourceOf(envelopeFrom: string): Source {
  const domain = /@([a-z0-9.-]+)\s*>?\s*$/i.exec(envelopeFrom.trim())?.[1]?.toLowerCase() ?? "";
  if (domain === "") return "";
  if (/^(gmail|googlemail)\.com$/.test(domain)) return "gmail";
  if (/(^|\.)(qq\.com|foxmail\.com)$/.test(domain)) return "qq";
  if (/(^|\.)(163\.com|126\.com|yeah\.net|188\.com)$/.test(domain)) return "netease";
  if (/^(outlook|hotmail|live|msn)\.[a-z.]+$/.test(domain)) return "outlook";
  return "other";
}

/** 记一次（或 by 次）。 */
export async function bump(env: Env, nowMs: number, userId: string, metric: Metric, source: Source | string = "", by = 1): Promise<void> {
  try {
    await env.DB.prepare(
      "INSERT INTO daily_stats (day, user_id, metric, source, n) VALUES (?, ?, ?, ?, ?) ON CONFLICT(day, user_id, metric, source) DO UPDATE SET n = n + excluded.n",
    )
      .bind(statDay(nowMs), userId, metric, source, by)
      .run();
  } catch {
    // 统计丢一次无所谓
  }
}

/** 一封信的处理结果拆成各类次数（拆开的夹带信逐封算）。 */
export function tallyHandling(handling: Handling, into: Map<Metric, number> = new Map()): Map<Metric, number> {
  const add = (m: Metric) => into.set(m, (into.get(m) ?? 0) + 1);
  switch (handling.kind) {
    case "split":
      for (const r of handling.results) tallyHandling(r, into);
      break;
    case "stored":
      add(handling.status);
      break;
    default:
      add(handling.kind);
  }
  return into;
}

/** 收信程序处理完一封信后调用：记「收到一封」和处理结果。 */
export async function recordHandling(env: Env, nowMs: number, userId: string | null, envelopeFrom: string, handling: Handling): Promise<void> {
  const user = userId ?? "";
  const source = sourceOf(envelopeFrom);
  await bump(env, nowMs, user, "mail_in", source);
  for (const [metric, n] of tallyHandling(handling)) await bump(env, nowMs, user, metric, source, n);
}

/**
 * 收信程序接收了一封信之后调用：记下它是凭什么被接收的（只有形状，没有地址和内容）。
 * evidence 为 null（没被接收）时什么都不记。
 */
export async function recordAdmission(env: Env, nowMs: number, userId: string | null, evidence: string | null): Promise<void> {
  if (userId === null || evidence === null) return;
  await bump(env, nowMs, userId, "admit", evidence.slice(0, 120));
}

/** 看板打开时调用：记下最近一次打开的时刻（一小时内不重复写）；当天第一次打开记一次 open。 */
export async function touchLastSeen(env: Env, userId: string, nowMs: number): Promise<void> {
  try {
    const row = await env.DB.prepare("SELECT last_seen_at FROM users WHERE id = ?").bind(userId).first<{ last_seen_at: string | null }>();
    const last = row?.last_seen_at ?? null;
    const sameDay = last !== null && last.slice(0, 10) === statDay(nowMs);
    if (last !== null && sameDay && Date.parse(last) > nowMs - 3_600_000) return;
    await env.DB.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").bind(new Date(nowMs).toISOString(), userId).run();
    if (!sameDay) await bump(env, nowMs, userId, "open");
  } catch {
    // 同上
  }
}

/** 今天一共发了几封信（验证码 + 邮件提醒 + 监控提醒），所有人合计。 */
export async function sendsToday(env: Env, nowMs: number): Promise<number> {
  const row = await env.DB.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM daily_stats WHERE day = ? AND metric IN ('login_code', 'reminder_mail', 'alert_mail', 'setup_mail')")
    .bind(statDay(nowMs))
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function pruneStats(env: Env, nowMs: number): Promise<void> {
  await env.DB.prepare("DELETE FROM daily_stats WHERE day < ?").bind(statDay(nowMs - KEEP_STATS_DAYS * 86_400_000)).run();
}
