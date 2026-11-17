import channels from "../../channels.json";

/**
 * 新用户从哪来（10/20）：打开看板时看一眼地址和来源网站，记在这台设备上，注册时一起交给服务器。
 * 只记第一次（先来的算），只在注册那一刻用；已有账号的人登录不会改。
 *
 * - 链接标记：?from=zhihu&c=帖子名
 * - 短网址：board.域名/xhs（小红书、抖音这种放不了链接、只能手打网址的地方用）
 * - 来源网站：从别的网站点进来时，只记那个网站的域名
 * 记完把地址栏改回干净的样子，免得截图、分享时带着标记。
 */

const KEY = "zd-source";

export interface Attribution {
  channel: string | null;
  campaign: string | null;
  referrer: string | null;
}

const KNOWN = new Set(Object.keys(channels.channels));

function domainOf(url: string): string | null {
  try {
    return url ? new URL(url).hostname.toLowerCase().replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

/** 从当前地址读出来源（纯函数，测试用）。 */
export function readFromLocation(href: string, referrer: string): { found: Attribution | null; cleanPath: string | null } {
  const url = new URL(href);
  const from = url.searchParams.get("from")?.trim().toLowerCase() ?? "";
  const campaign = url.searchParams.get("c")?.trim() ?? "";
  const short = /^\/([a-z0-9_-]{2,24})\/?$/.exec(url.pathname)?.[1] ?? "";
  const channel = from || (KNOWN.has(short) ? short : "");
  const ref = domainOf(referrer);
  // 自己网站内部跳转不算来源
  const base = url.hostname.split(".").slice(-2).join(".");
  const external = ref !== null && ref !== base && !ref.endsWith(`.${base}`) ? ref : null;
  const tagged = from.length > 0 || campaign.length > 0 || (short.length > 0 && KNOWN.has(short));
  const found = channel || campaign || external ? { channel: channel || null, campaign: campaign || null, referrer: external } : null;
  if (!tagged) return { found, cleanPath: null };
  url.searchParams.delete("from");
  url.searchParams.delete("c");
  const path = KNOWN.has(short) ? "/" : url.pathname;
  return { found, cleanPath: `${path}${url.search}${url.hash}` };
}

/** 页面一打开就调用。 */
export function captureAttribution(): void {
  try {
    const { found, cleanPath } = readFromLocation(window.location.href, document.referrer);
    if (found !== null && window.localStorage.getItem(KEY) === null) window.localStorage.setItem(KEY, JSON.stringify(found));
    if (cleanPath !== null) window.history.replaceState(null, "", cleanPath);
  } catch {
    // 无痕模式等存不了：不影响使用
  }
}

/** 注册（填验证码）时带上。 */
export function storedAttribution(): Attribution | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Attribution) : null;
  } catch {
    return null;
  }
}
