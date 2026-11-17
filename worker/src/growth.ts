import channels from "../channels.json";
import type { Env } from "./types.js";

/**
 * 增长统计（10/20）：新用户从哪来。只在注册那一刻记一次，之后不跟踪。
 *
 * 三层，统计时按这个顺序认：
 * 1. 链接或短网址带的渠道标记（?from=zhihu&c=帖子名、board.域名/xhs）
 * 2. 注册后那道「你是从哪知道准点的」的回答（只问前两层都没认出来的人）
 * 3. 从别的网站点进来时那个网站的域名（搜索引擎归「搜索」）
 * 都没有 = 直接访问。
 */

export interface Signup {
  channel: string | null;
  campaign: string | null;
  referrer: string | null;
}

export const SOURCE_ANSWERS: readonly string[] = [...channels.answers.map((a) => a.id), "skip"];

const CHANNEL_RE = /^[a-z0-9][a-z0-9_-]{0,23}$/;
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** 看板发来的来源信息：格式不对的一律丢掉，不报错（来源只是统计，不能挡住注册）。 */
export function cleanSignup(raw: unknown, ownDomain: string): Signup {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const channel = str(r.channel).toLowerCase();
  const campaign = str(r.campaign)
    .replace(/[^\p{L}\p{N}_.-]/gu, "")
    .slice(0, 40);
  const referrer = str(r.referrer).toLowerCase().replace(/^www\./, "").slice(0, 80);
  const own = referrer === ownDomain || referrer.endsWith(`.${ownDomain}`);
  return {
    channel: CHANNEL_RE.test(channel) ? channel : null,
    campaign: campaign.length > 0 ? campaign : null,
    referrer: DOMAIN_RE.test(referrer) && !own ? referrer : null,
  };
}

/** 刚建好的账号记下来源。 */
export async function saveSignup(env: Env, userId: string, signup: Signup): Promise<void> {
  if (signup.channel === null && signup.campaign === null && signup.referrer === null) return;
  await env.DB.prepare("UPDATE users SET signup_channel = ?, signup_campaign = ?, signup_referrer = ? WHERE id = ?")
    .bind(signup.channel, signup.campaign, signup.referrer, userId)
    .run();
}

/** 要不要问「你是从哪知道准点的」：作者不问；链接已经认出来的不问；答过（或跳过）的不再问。 */
export async function shouldAskSource(env: Env, userId: string, role: string): Promise<boolean> {
  if (role === "owner") return false;
  const row = await env.DB.prepare("SELECT signup_channel, signup_answer FROM users WHERE id = ?")
    .bind(userId)
    .first<{ signup_channel: string | null; signup_answer: string | null }>();
  return row !== null && row.signup_channel === null && row.signup_answer === null;
}

/** 记下回答。不在选项里的不收。 */
export async function saveSourceAnswer(env: Env, userId: string, answer: unknown): Promise<boolean> {
  if (typeof answer !== "string" || !SOURCE_ANSWERS.includes(answer)) return false;
  await env.DB.prepare("UPDATE users SET signup_answer = ? WHERE id = ? AND signup_answer IS NULL").bind(answer, userId).run();
  return true;
}
