import type { EmailRow, LiveData } from "@/lib/demo/liveData";

export { toLiveData } from "@/lib/demo/liveData";
export type { EmailRow, LiveData };

export interface NoticeRow {
  id: string;
  kind: string;
  received_at: string;
  subject: string;
  body: string;
}

/** 看板详情里「模型和规则各管什么」那句。 */
export function extractorNote(
  models: ReadonlyMap<string, string | null>,
  ids: readonly string[],
  errors: ReadonlyMap<string, string | null> = new Map(),
): string {
  const used = [...new Set(ids.map((id) => models.get(id)).filter((m): m is string => typeof m === "string"))];
  if (used.length > 0) return `公司、岗位、时间片段由模型从原文摘出（${used.join("、")}）；是什么事、什么时候、哪个时区由规则判断。`;
  // 没用上模型：照收信时记下的原因说清楚是哪一种，用户才知道该怎么办
  const reason = ids.map((id) => errors.get(id)).find((e): e is string => typeof e === "string" && e.length > 0) ?? null;
  if (reason?.startsWith("模型调用失败")) {
    const detail = reason.replace(/^模型调用失败，已退回纯规则[:：]?\s*/, "").slice(0, 80);
    return `收信时 AI 没响应${detail ? `（${detail}）` : ""}，这封只用规则判断。可以在「设置 → 收信」里点「用 AI 重新解析」。`;
  }
  if (reason?.includes("关掉了 AI")) return "收信时你的 AI 是关着的，这封只用规则判断。在「设置 → AI 与简历」里可以打开。";
  if (reason?.includes("额度用完")) return "收信那天的 AI 额度用完了，这封只用规则判断。";
  return "收信时没有可用的 AI 模型（服务器没配置模型），这封只用规则判断。";
}

/** 转发确认只看最近 7 天的：开通转发是一次性的，过期的不必一直挂着。 */
export const NOTICE_WINDOW_MS = 7 * 86_400_000;

/** 邮箱服务商自己的域名：确认信里只有指向这些域名的链接才做成按钮（防伪造的确认信骗人点链接）。 */
const TRUSTED_LINK_HOSTS = ["qq.com", "google.com", "163.com", "126.com", "yeah.net", "outlook.com", "live.com", "microsoft.com"];

function trustedLink(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && TRUSTED_LINK_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

export interface ForwardingNotice {
  id: string;
  /** gmail：Gmail 的转发验证码；other：其他邮箱（QQ 等）的转发确认信。 */
  provider: "gmail" | "other";
  subject: string;
  receivedAt: string;
  code: string | null;
  /** 确认信里的按钮：文字 + 地址（只留服务商自己域名的）。 */
  links: { label: string; url: string }[];
  /** 正文开头一段：认不出验证码和按钮时整段给人看。 */
  excerpt: string;
}

/**
 * 还要处理的邮箱转发确认：Gmail 的验证码、QQ 等的确认链接。最新的在前。
 * - 只看最近 7 天；
 * - 点了确认按钮或「我已确认好了」就删掉（不靠「之后有没有信进来」判断：手动转发的信也会进来，会把还没确认的按钮藏掉，10/16 踩过）；
 * - 同一个邮箱重复申请了几次，只留最新那封（旧的验证码已经作废）。
 */
/** 同一个邮箱的转发确认归成一组：Gmail 的全算一组，其他按标题。 */
function noticeKey(notice: NoticeRow): string {
  return notice.kind === "gmail-forwarding" ? "gmail" : notice.subject;
}

/**
 * 点了确认（或「我已确认好了」）：同一个邮箱以前发来的旧确认也一起删掉。
 * 只删最新那封的话，下一封旧的会顶上来，再点它的链接 Gmail 会说验证失败（旧链接已作废，10/16 踩过）。
 */
export function noticeGroupIds(notices: readonly NoticeRow[], id: string): string[] {
  const target = notices.find((n) => n.id === id);
  if (!target) return [id];
  const key = noticeKey(target);
  return notices.filter((n) => n.kind === target.kind && noticeKey(n) === key).map((n) => n.id);
}

export function forwardingNotices(notices: readonly NoticeRow[], nowMs: number): ForwardingNotice[] {
  const out: ForwardingNotice[] = [];
  const seen = new Set<string>();
  for (const notice of notices) {
    if (notice.kind !== "gmail-forwarding" && notice.kind !== "forward-verify") continue;
    if (nowMs - Date.parse(notice.received_at) > NOTICE_WINDOW_MS) continue;
    const key = noticeKey(notice);
    if (seen.has(key)) continue;
    seen.add(key);
    const code = notice.kind === "gmail-forwarding" ? (/验证码：(\d{6,})/.exec(notice.body)?.[1] ?? null) : null;
    const links: { label: string; url: string }[] = [];
    for (const match of notice.body.matchAll(/([^\s（）()]{1,30})（(https?:\/\/[^\s）]+)）/g)) {
      const url = match[2];
      // 中文句子没有空格，前面会带上半句话：只留最后一个分句，去掉「请点击」
      const label = (match[1] ?? "").split(/[，。,.:：；;！!]/).pop()?.replace(/^(请)?(点击|点)/, "");
      if (label && url && trustedLink(url) && !links.some((l) => l.url === url)) links.push({ label, url });
    }
    // 纯文本里光秃秃的地址（Gmail 的确认信就是这样）：第一个就是确认链接，做成按钮；后面的（帮助页之类）不要
    if (links.length === 0) {
      for (const match of notice.body.matchAll(/https:\/\/[^\s（）()<>"']+/g)) {
        const url = match[0].replace(/[.,，。；;]+$/, "");
        if (trustedLink(url)) {
          links.push({ label: "一键确认转发", url });
          break;
        }
      }
    }
    const excerpt = notice.body.replace(/^发件人：[^\n]*\n+/, "").replace(/^验证码：\d+\n+/, "").slice(0, 600).trim();
    out.push({ id: notice.id, provider: notice.kind === "gmail-forwarding" ? "gmail" : "other", subject: notice.subject, receivedAt: notice.received_at, code, links, excerpt });
  }
  return out;
}

/**
 * 保存手动操作（PUT /api/edits）的结果，页面该怎么办：
 * - saved：存上了，记下云端的新版本号（老服务端不给版本号时为 null，之后就不带版本号存）
 * - conflict：别处（另一台设备、另一个标签页）先改过了。云端没有动，把云端那份换到页面上，
 *   刚才那一步要你再做一次——不替你合并，合错了比多点一下糟得多
 * - signed-out：登录过期
 * - failed：其他错误
 */
export type SaveOutcome =
  | { kind: "saved"; version: string | null }
  | { kind: "conflict"; edits: unknown; version: string }
  | { kind: "signed-out" }
  | { kind: "failed" };

export function saveOutcome(status: number, body: unknown): SaveOutcome {
  const b = (typeof body === "object" && body !== null ? body : {}) as { version?: unknown; conflict?: unknown; edits?: unknown };
  if (status === 401) return { kind: "signed-out" };
  if (status >= 200 && status < 300) return { kind: "saved", version: typeof b.version === "string" ? b.version : null };
  if (status === 409 && b.conflict === true && typeof b.version === "string") return { kind: "conflict", edits: b.edits ?? null, version: b.version };
  return { kind: "failed" };
}

/**
 * 标题下面那句「N 封转发来的邮件」。存的比显示的多时必须说出来：
 * 悄悄少掉的信，对应的日程和投递记录也跟着消失，而你不会知道。
 */
export function emailCountNotice(shown: number, total: number | null, inbox: string): string {
  if (shown === 0) return `还没有收到邮件（招聘邮件转发到 ${inbox} 就会出现在这里）`;
  if (total !== null && total > shown) return `只显示最近 ${shown} 封（一共存了 ${total} 封）：更早的信不在看板、日历和提醒里`;
  return `${shown} 封转发来的邮件`;
}
