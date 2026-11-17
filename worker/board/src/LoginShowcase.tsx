import { Mail } from "lucide-react";
import { BrandMark } from "@/components/demo/BrandMark";

/**
 * 登录页左边的动态背景（10/20 定稿：方案 A「信件变日程」）。
 * 收件箱里的招聘邮件一封封亮起、飞进「准」字，右边攒出换算好时间的日程卡。纯装饰：读屏跳过，开了「减少动态效果」就是静止画面。
 * 内容都是示意，不是真实邮件，也不出现真实公司名。动画在 index.css 的 .zd-* 里。
 */

const CHIPS = [
  "【一面邀请】产品经理 · 10月23日 14:00（北京时间）",
  "在线测评：请在收到邮件后 72 小时内完成",
  "Interview invitation — Tue, Oct 27, 9:30 AM PT",
  "网申投递成功通知",
  "笔试通知：10月25日 19:00 开考",
] as const;

const CHIP = "absolute left-0 flex h-11 w-[260px] items-center gap-2.5 overflow-hidden rounded-[10px] border border-hairline bg-surface px-3.5 text-[13px] whitespace-nowrap text-ink shadow-card";

type Tone = "meet" | "due" | "done";
const TONE: Record<Tone, string> = {
  meet: "bg-brand-soft text-on-brand-soft",
  due: "bg-accent-soft text-ink",
  done: "bg-offer-soft text-on-offer-soft",
};

const CARDS: { tag: string; tone: Tone; title: string; main?: [string, string]; sub: string; top: number }[] = [
  { tag: "一面", tone: "meet", title: "产品经理", main: ["周五 02:00", "纽约"], sub: "= 周五 14:00 北京", top: 0 },
  { tag: "测评", tone: "due", title: "在线测评", main: ["72 小时内截止", ""], sub: "截止前 24 小时、3 小时各提醒一次", top: 96 },
  { tag: "面试", tone: "meet", title: "Interview", main: ["周二 12:30", "纽约"], sub: "= 周二 9:30 太平洋时间", top: 192 },
  { tag: "网申", tone: "done", title: "已投递", sub: "记进进度，不用你做什么", top: 288 },
  { tag: "笔试", tone: "meet", title: "周日 07:00 纽约", sub: "= 周日 19:00 北京", top: 358 },
];

/** 大标题 + 一句话。宽屏放在动画上面，窄屏放在登录卡片上面。 */
export function LoginTagline({ compact = false }: { compact?: boolean }) {
  return (
    <div>
      <p className={`${compact ? "text-3xl" : "text-[44px] leading-tight"} font-black tracking-[0.02em] text-ink`}>
        每一场面试，都<span className="underline decoration-accent decoration-[6px] underline-offset-[8px]">准点</span>
      </p>
      <p className={`mt-3 ${compact ? "text-sm" : "text-base"} leading-relaxed text-ink-soft`}>招聘邮件转进来，日程自动排好：换成你那边的时间，截止前提醒你。</p>
    </div>
  );
}

export function LoginShowcase() {
  return (
    <div className="flex flex-col gap-12" data-login-showcase>
      <LoginTagline />
      <div aria-hidden className="relative h-[480px] w-[600px] select-none">
        <span className="absolute top-[-28px] left-0 text-xs font-medium tracking-[0.12em] text-ink-faint">转发来的信</span>
        <span className="absolute top-[-28px] left-[380px] text-xs font-medium tracking-[0.12em] text-ink-faint">你的日程</span>
        <svg width="600" height="480" className="absolute inset-0">
          <path className="zd-flow" d="M268 182 H294" stroke="var(--jcc-brand)" strokeWidth="2" strokeDasharray="6 6" fill="none" />
          <path className="zd-flow" d="M378 182 H380" stroke="var(--jcc-brand)" strokeWidth="2" strokeDasharray="6 6" fill="none" />
        </svg>
        {CHIPS.map((text, i) => (
          <div key={text}>
            {/* 收件箱里的信一直在；轮到它时边框变黄，处理完变淡 */}
            <div className={`zd-a zd-mail${i + 1} ${CHIP}`} style={{ top: 20 + i * 70 }}>
              <Mail size={16} className="shrink-0 text-brand-line" />
              <span className="truncate">{text}</span>
            </div>
            {/* 飞进「准」字的那一份 */}
            <div className={`zd-a zd-ghost zd-ghost${i + 1} ${CHIP}`} style={{ top: 20 + i * 70 }}>
              <Mail size={16} className="shrink-0 text-brand-line" />
              <span className="truncate">{text}</span>
            </div>
          </div>
        ))}
        <div className="absolute top-[146px] left-[300px] h-[72px] w-[72px]">
          <div className="zd-ring absolute inset-0 rounded-[20px] border-2 border-accent" />
          <div className="relative">
            <BrandMark size={72} />
          </div>
        </div>
        {CARDS.map((c, i) => (
          <div key={c.tag + c.title} className={`zd-a zd-card${i + 1} absolute left-[380px] w-[220px] rounded-xl border border-hairline bg-surface px-3.5 py-3 text-ink shadow-card`} style={{ top: c.top }}>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${TONE[c.tone]}`}>{c.tag}</span>
              <span className="text-[13px] font-bold">{c.title}</span>
            </div>
            {c.main ? (
              <div className="mt-1.5 text-sm font-bold">
                {c.main[0]} <span className="font-normal text-ink-soft">{c.main[1]}</span>
              </div>
            ) : null}
            <div className="mt-0.5 text-xs text-ink-faint">{c.sub}</div>
          </div>
        ))}
        <span className="absolute bottom-[-32px] left-0 text-xs text-ink-faint">示意内容，不是真实邮件</span>
      </div>
    </div>
  );
}
