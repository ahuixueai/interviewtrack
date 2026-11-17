import { describe, expect, it } from "vitest";
import { classifyEventType } from "../src/eventType.js";
import { classifyEventFormat } from "../src/eventFormat.js";

/**
 * 信里**提到**一个环节，不等于这封信**是**那个环节（2026-11-10 样本外评测暴露的三类）。
 *
 * - 上一轮的客套：「Thank you for attending our recent assessment. We invite you to the Manager Interview」
 *   说的是面试，测评已经做完了
 * - 以后的安排：「已收到您的申请……笔面试将滚动安排」是回执，没有要你现在去面试
 * - 做完的确认：「Thank you for completing your assessment」不是又一场测评
 *
 * 用例全部是合成文本，公司、人名、链接都是编的。真实邮件原文留在私有的 eval/ 下。
 */

describe("上一轮的客套不抢走这一轮的邀请", () => {
  const subject = "Northwind Manager Interview Invitation 北风经理视频面试邀请函";
  const body = [
    "Dear 林同学:",
    "Thank you for attending our recent assessment.",
    "We are pleased to invite you to the next stage of the assessment process – Manager Interview for the position of Analyst. It will be conducted via an online meeting, details as follows:",
    "Date & Time: 2026-11-11 10:00 Beijing Time",
    "To confirm your availability, please reply before 17:00 6 Nov, 2026, Beijing Time. If you choose \"Accept Interview\", you are confirming that you will attend the assessment per the time indicated above.",
  ].join("\n");

  it("英文：感谢参加测评 + 邀请经理面试 = 面试", () => {
    expect(classifyEventType({ subject, body }).eventType).toBe("interview");
  });

  it("形式跟着变成视频面试", () => {
    expect(classifyEventFormat(body, "interview", subject).format).toBe("video_interview");
  });

  it("中文：感谢参加笔试 + 邀请面试 = 面试", () => {
    const zh = "感谢您参加北风科技的在线笔试。现邀请您参加下一轮面试，时间为 11 月 12 日 14:00（北京时间）。";
    expect(classifyEventType({ subject: "下一轮通知", body: zh }).eventType).toBe("interview");
  });

  it("只有客套、没有别的环节时不受影响：照样是测评", () => {
    const only = "感谢您参加北风科技校园招聘在线测评环节，请于 3 天内点击链接完成作答。";
    expect(classifyEventType({ subject: "测评邀请", body: only }).eventType).toBe("assessment");
  });

  it("测评邀请里顺带一句「笔试另行通知」：照样是测评", () => {
    const b = "现邀请你参加在线测评，请于收到通知 3 天内完成。与岗位相关的专业笔试环节将作另外通知。";
    expect(classifyEventType({ subject: "测评邀请函", body: b }).eventType).toBe("assessment");
  });
});

describe("回执里说「笔面试将滚动安排」还是回执", () => {
  it("已收到申请 + 笔面试将滚动安排 = 投递成功", () => {
    const body = "林同学，你好！感谢您对北风银行校园招聘的关注，我们已收到您对“管理培训生”的申请，并会尽快查看简历。\n招聘期间笔面试将滚动安排，请耐心等待并留意通知；";
    expect(classifyEventType({ subject: "【北风银行】投递成功通知", body }).eventType).toBe("application_ok");
  });

  it("写了具体时间的不是「以后的安排」：照样是面试", () => {
    const body = "我们已收到您的申请。面试将于 10 月 20 日 14:00 进行，请准时参加。";
    expect(classifyEventType({ subject: "面试通知", body }).eventType).toBe("interview");
  });

  it("回执 + 当场发测评链接：行动项优先，照样是测评", () => {
    const body = "我们已收到您的申请。请于 72 小时内完成在线测评：https://exam.example/abc 。后续面试将另行通知。";
    expect(classifyEventType({ subject: "投递成功", body }).eventType).toBe("assessment");
  });
});

describe("「已提交」的确认不是又一场测评", () => {
  it("Thank you for completing your assessment = 不是要做的事", () => {
    const body = "Hi Lin,\nThank you for taking the time to complete our assessment. This email serves as a confirmation that your assessment was successfully submitted. You will be contacted in the event we decide to move forward with your application.";
    const c = classifyEventType({ subject: "Thank you for completing your Northwind Assessment", body });
    expect(c.eventType).toBe("other");
    expect(c.actionable).toBe(false);
    expect(c.final).toBe(true);
  });

  it("催你做完的提醒不受影响：照样是测评相关", () => {
    const body = "As a reminder, your application will not be considered until all sections of the assessment are completed. To complete your assessment, use the link below.";
    const c = classifyEventType({ subject: "Reminder to complete your Northwind Assessment", body });
    expect(c.mergeAs ?? c.eventType).toBe("assessment");
  });

  it("做完测评后紧接着邀请面试：是面试，不是确认", () => {
    const body = "Thank you for completing our assessment. We would like to invite you to a video interview on Nov 12 at 3:00 PM EST.";
    expect(classifyEventType({ subject: "Next steps", body }).eventType).toBe("interview");
  });
});
