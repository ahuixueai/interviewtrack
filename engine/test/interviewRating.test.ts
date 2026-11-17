import { describe, expect, it } from "vitest";
import { classifyEventType } from "../src/eventType.js";
import { EMPTY_EXTRACTION } from "../src/extract.js";
import type { LLMExtractor } from "../src/extract.js";
import { route } from "../src/inbox.js";
import { parseEmail } from "../src/pipeline.js";

/**
 * 面试后的评价邀请不是一场面试（2026-11-16 作者在待确认里看到的真实情况）。
 *
 * 「某公司诚邀你对本次面试进行评价」：标题和正文满篇「面试」，信里又没有时间，
 * 于是被判成「面试（形式未说明）」摆进待确认。它和满意度问卷是一回事——
 * 填不填都不影响结果，不是流程里的一步，应该直接折叠。
 *
 * 只看标题，而且要是「请你评价这次面试」的句式：
 * 正文里一句「面试官将对你的表现进行评价」不能把真的面试通知挡掉。
 *
 * 用例全部是合成文本，公司、人名、链接都是编的。
 */

const BODY = [
  "此邮件由系统发出，请勿直接回复或转发他人",
  "林同学， 你好",
  "感谢你参加了我司 市场运营助理 的面试，现邀请你对此次面试做出评价。我们很重视你的评价！如你未参加本次面试，请忽略此邮件。",
  "点击下方按钮，即可评价：",
  "立即评价（https://survey.example/v2/abc）",
].join("\n");

describe("面试后的评价邀请：不是面试", () => {
  it.each([
    "北风科技有限公司诚邀你对本次面试进行评价",
    "请您对本次面试做出评价",
    "邀请您对此次笔试进行评价",
    "【北风科技】诚邀您对本场面试体验打分",
  ])("标题「%s」→ 不是流程里的一步", (subject) => {
    const c = classifyEventType({ subject, body: BODY });
    expect(c.eventType).toBe("other");
    expect(c.actionable).toBe(false);
    expect(c.final).toBe(true);
  });

  it("整条管线：模型说它是面试也不采纳，折叠起来，不进待确认、不进日程", async () => {
    const saysInterview: LLMExtractor = {
      extract: () => Promise.resolve({ ...EMPTY_EXTRACTION, companyRaw: "北风科技有限公司", roleRaw: "市场运营助理", eventTypeHint: "interview" }),
    };
    const outcome = await parseEmail(
      {
        id: "rating-1",
        from: "招聘助手 <northwind-noreply@ats.example>",
        to: "jobs@my.example",
        subject: "北风科技有限公司诚邀你对本次面试进行评价",
        body: BODY,
        receivedAtUtc: "2026-11-16T03:00:00.000Z",
      },
      { extractor: saysInterview },
    );
    if (outcome.kind === "dropped") return; // 直接丢掉也算达标
    expect(outcome.event.eventType).toBe("other");
    expect(route(outcome.event.confidence, outcome.event.eventType, outcome.trace.confidenceReasons).destination).toBe("noise");
  });
});

describe("真的面试通知不受影响", () => {
  it("正文里说「面试官将对你的表现进行评价」：照样是面试", () => {
    const body = "诚邀你参加 11 月 20 日 14:00（北京时间）的视频面试。面试官将对你的表现进行评价，结果将在一周内通知。";
    expect(classifyEventType({ subject: "面试邀请", body }).eventType).toBe("interview");
  });

  it("正文里预告「面试结束后会邀请你对本次面试进行评价」：照样是面试", () => {
    const body = "面试时间：11 月 20 日 14:00（北京时间）。面试结束后，我们会邀请你对本次面试进行评价。";
    expect(classifyEventType({ subject: "视频面试通知", body }).eventType).toBe("interview");
  });

  it("标题是面试结果，不是请你评价：不走这条规则", () => {
    const body = "很遗憾，您未能通过本次面试。";
    expect(classifyEventType({ subject: "面试评价结果通知", body }).eventType).toBe("result");
  });
});
