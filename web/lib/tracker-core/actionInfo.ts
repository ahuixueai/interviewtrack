// 生成物：由 scripts/sync-tracker-core.mjs 从 engine/src 同步而来，不要手改。
/**
 * 行动信息：做这件事要用到的**入口链接**和**凭据**（测评密钥、考试码、会议号……）。
 *
 * 这一层全部用规则，不交给模型，原因有两条：
 *
 * 1. 链接和密钥必须**逐字正确**。模型把 `Xk7-92Qp` 抄成 `Xk7-92Op`，用户就登不进去，
 *    而且看不出哪里错了。正则摘出来的要么一字不差，要么没有。
 * 2. 它们本来就有稳定的形态（`https://…`、「密钥：xxxx」），不需要理解语义。
 *
 * 只摘、不判断、不访问：这里从不请求任何链接，也不判断链接是否可信——
 * 那是展示层要提醒用户的事。
 */

export interface Credential {
  /** 信里对它的叫法，如「测评密钥」「会议号」。原样保留，用户照着找输入框。 */
  label: string;
  value: string;
}

/**
 * 链接是干什么的。一封笔试通知里常常有好几个链接（牛客一封信就有五个），
 * 只有一个是真正的考试入口，其余是「确认参加」、模拟练习、浏览器下载……
 *
 * - entry：去做这件事的入口（考试地址、面试会议、测评链接）
 * - confirm：要你先点一下确认参加 / 回复时间
 * - practice：模拟考试、练习题、设备调试
 * - info：须知、帮助帖、下载地址
 * - other：看不出是什么
 */
export type LinkKind = "entry" | "confirm" | "practice" | "info" | "other";

export interface LinkDetail {
  url: string;
  kind: LinkKind;
  /** 信里对它的叫法（链接前面那句话），如「考试地址」「确认是否参加考试」。看不出就是 null。 */
  label: string | null;
}

export interface ActionInfo {
  /** 入口链接，最像「去做这件事」的排在最前。不含退订、隐私政策这类页脚链接。 */
  links: readonly string[];
  /** 和 links 同序，每个链接是干什么的、信里怎么叫它。 */
  linkDetails: readonly LinkDetail[];
  credentials: readonly Credential[];
}

export const EMPTY_ACTION_INFO: ActionInfo = { links: [], linkDetails: [], credentials: [] };

const MAX_LINKS = 5;
const MAX_CREDENTIALS = 4;

/** URL 到这些字符为止。中文邮件里链接后面常直接跟全角标点，不能吃进去。 */
const URL_PATTERN = /https?:\/\/[^\s<>"'`，。；、！？（）【】「」《》]+/gi;

/** 页脚链接：与「做这件事」无关，放进详情只会让人点错。 */
const FOOTER_LINK = /unsubscribe|退订|privacy|隐私|terms|条款|preferences|help|faq|support/i;

/** 链接前面出现这些词，说明它是入口（弱提示：「点击」「链接」也算）。 */
const ENTRY_CUE =
  /测评|笔试|考试|面试|作答|入口|登录|链接|点击|会议|assessment|test|exam|interview|join|start|begin|launch|link|click/i;

/** 强提示：明确说了这是考试 / 面试 / 会议的地址。 */
const STRONG_ENTRY =
  /(考试|笔试|面试|测评|作答|答题|会议)(地址|入口|链接|网址)|(进入|开始|参加)(考试|笔试|面试|测评|作答|会议)|(interview|meeting|assessment|test|exam)\s*(link|url)|join\s+(the\s+)?(meeting|interview|call)/i;

/** 要你先确认参加、回复时间的链接。 */
const CONFIRM_CUE = /确认是否参加|确认参加|是否参加|确认出席|回复确认|接受邀请|确认时间|选择时间|预约时间|confirm|rsvp|accept|schedule\s+a\s+time/i;

/** 模拟、练习、调试：考前可以点，但不是考试本身。 */
const PRACTICE_CUE = /模拟|练习|调试|试做|样题|题库|设备检测|环境检测|practice|mock|sample|demo|trial|system\s*check/i;
const PRACTICE_URL = /acm_oj_test|\/exam\/oj\b|practice|mock|demo/i;

/** 须知、帮助、下载：说明性质。 */
const INFO_CUE =
  /下载|须知|说明|常见问题|帮助|指南|教程|攻略|官网|介绍|download|guide|instructions|learn\s+more|find\s+out\s+more|more\s+information|information\s+(?:on|about)|accommodation|disability/i;
const INFO_URL = /\/discuss\/|download/i;

const KIND_RANK: Readonly<Record<LinkKind, number>> = { entry: 0, confirm: 1, practice: 2, info: 3, other: 4 };

export function linkKindRank(kind: LinkKind): number {
  return KIND_RANK[kind];
}

function trimUrl(raw: string): string {
  // 句末的半角标点属于句子，不属于链接；末尾光秃秃的 # 也不要（牛客的链接都带一个，打开是同一页）
  return raw.replace(/[.,;:!?)\]}>]+$/, "").replace(/#$/, "");
}

/** 链接前面的那句话：同一行里链接前的最后一个分句；链接独占一行就看上一行。 */
function clauseBefore(source: string, index: number): string {
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  let before = source.slice(lineStart, index);
  if (before.replace(/[\s（(【\[：:]+/g, "").length === 0) {
    // 链接独占一行：取上一个非空行
    const lines = source.slice(0, lineStart).split("\n").map((l) => l.trim()).filter(Boolean);
    before = lines.at(-1) ?? "";
  }
  const clauses = before
    .split(/[，,。；;：:！!？?（(【\[]/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  // 判断用途要看整句（「You can find more information on … here」前半句才是关键），标签太长会在 labelOf 里丢掉
  return (clauses.at(-1) ?? "").slice(-100);
}

const LABEL_PREFIX = /^(请您?|您可|可以|建议(你|您)?(提前)?(进行|在)?|点击|进入|访问|打开|前往|通过)+/;

/** 分句整理成标签。太长、看着像网址、什么都没剩，就不当标签。 */
function labelOf(clause: string): string | null {
  const label = clause.replace(LABEL_PREFIX, "").replace(/^(?:please\s+)?(?:visit|click(?:\s+here)?|go\s+to|see|use)\b\s*/i, "").replace(/[\s*·•\-—>»]+$/, "").trim();
  if (label.length < 2 || /[./]\w/.test(label)) return null;
  const cjk = /[\u4e00-\u9fff]/.test(label);
  if (label.length > (cjk ? 16 : 32)) return null;
  return label;
}

function kindOf(clause: string, url: string): LinkKind {
  if (CONFIRM_CUE.test(clause)) return "confirm";
  if (PRACTICE_CUE.test(clause)) return "practice";
  if (STRONG_ENTRY.test(clause)) return "entry";
  if (INFO_CUE.test(clause)) return "info";
  if (PRACTICE_URL.test(url)) return "practice";
  if (INFO_URL.test(url)) return "info";
  if (ENTRY_CUE.test(clause)) return "entry";
  return "other";
}

/** 跟踪链接（awstrack、sendgrid…）把真正的网址编码在自己里面。解码后包含一个已经列过的网址，就是它的副本。 */
function wrapsSeen(url: string, seen: ReadonlySet<string>): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    return false;
  }
  if (decoded === url && !/https?:\/\/.*https?:\/\//.test(url)) return false;
  for (const earlier of seen) {
    const bare = earlier.replace(/^https?:\/\//, "");
    if (bare.length >= 12 && decoded.includes(bare) && !earlier.includes(decoded)) return true;
  }
  return false;
}

export function extractLinkDetails(text: string): LinkDetail[] {
  const source = text ?? "";
  const found: (LinkDetail & { order: number })[] = [];
  const seen = new Set<string>();
  let order = 0;
  for (const match of source.matchAll(URL_PATTERN)) {
    const url = trimUrl(match[0]);
    if (url.length < 12 || seen.has(url) || FOOTER_LINK.test(url)) continue;
    // 纯文本版邮件常写成「网址（跟踪链接）」：跟踪链接里包着前面那个网址，同一个地方不列两次
    if (wrapsSeen(url, seen)) continue;
    seen.add(url);
    const clause = clauseBefore(source, match.index ?? 0);
    found.push({ url, kind: kindOf(clause, url), label: labelOf(clause), order });
    order += 1;
  }
  // 入口在前，然后是确认、练习、须知，看不出的最后；同类保持原文顺序
  found.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.order - b.order);
  return found.slice(0, MAX_LINKS).map(({ url, kind, label }) => ({ url, kind, label }));
}

export function extractLinks(text: string): string[] {
  return extractLinkDetails(text).map((d) => d.url);
}

/**
 * 凭据的叫法。长的排前面，避免「测评密钥」只匹配到「密钥」。
 *
 * ⚠️ 不含「验证码」：登录验证码是一次性的、几分钟就失效，而且整封信在预筛就被
 * 丢掉了；把它当凭据存下来既没用，也是不该留的东西。
 */
const CODE_LABEL =
  "测评密钥|测评码|考试密钥|考试码|准考证号|邀请码|授权码|登录码|登录密码|初始密码|会议密码|入会密码|密钥|口令|密码" +
  "|access\\s*code|pass\\s*code|invitation\\s*code|invite\\s*code|exam\\s*code|test\\s*code|password|passcode|pin";

/**
 * 「标签：值」。值是一段不含空白的串，至少 4 位：字母数字开头，
 * 中间允许密码里常见的符号（`Xh@2026`、`BC-7Q2M`）。
 */
const CODE_PATTERN = new RegExp(
  `(${CODE_LABEL})\\s*(?:[:：]|为|是|is)?\\s*([A-Za-z0-9][A-Za-z0-9_@#$%&*+=!.-]{3,31})(?![A-Za-z0-9])`,
  "gi",
);

/** 会议号单独处理：它是带空格或连字符分组的数字，如「123 456 789」。 */
const MEETING_PATTERN =
  /(会议号|会议\s*ID|meeting\s*(?:id|number))\s*(?:[:：]|为|是|is)?\s*(\d{3,4}(?:[\s-]?\d{3,4}){1,3})/gi;

export function extractCredentials(text: string): Credential[] {
  const source = text ?? "";
  const out: Credential[] = [];
  const seen = new Set<string>();
  const push = (label: string, value: string): void => {
    const cleanLabel = label.replace(/\s+/g, " ").trim();
    const cleanValue = value.trim();
    if (seen.has(cleanValue) || out.length >= MAX_CREDENTIALS) return;
    seen.add(cleanValue);
    out.push({ label: cleanLabel, value: cleanValue });
  };
  for (const m of source.matchAll(MEETING_PATTERN)) push(m[1] ?? "", m[2] ?? "");
  for (const m of source.matchAll(CODE_PATTERN)) {
    // 句末的 . 和 ! 属于句子，不属于凭据
    const value = (m[2] ?? "").replace(/[.!]+$/, "");
    // 纯字母的多半是普通单词（「密码 error」「password reset」），真凭据几乎都带数字
    if (!/\d/.test(value)) continue;
    push(m[1] ?? "", value);
  }
  return out;
}

export function extractActionInfo(text: string): ActionInfo {
  const linkDetails = extractLinkDetails(text);
  return { links: linkDetails.map((d) => d.url), linkDetails, credentials: extractCredentials(text) };
}
