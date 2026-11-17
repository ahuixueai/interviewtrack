import { describe, expect, it } from "vitest";
import { classifyEventType } from "../src/eventType.js";
import { decodeHtmlEntities } from "../src/text.js";

describe("明确的拒绝不被「面试」两个字抢走", () => {
  it("客气的拒信：「无法安排后续环节」+「以后邀请你参加其他岗位的面试」= 结果", () => {
    const body = [
      "你好，感谢你参加某公司中国校园招聘！经过对当前阶段的综合评估，我们很抱歉暂时无法为你安排后续环节。",
      "我们看到你展现出的优秀潜力和特质，你的简历将进入人才调剂池，希望未来或有机会邀请你参加其他岗位的面试。",
    ].join("\n");
    expect(classifyEventType({ subject: "校园招聘-感谢你的关注与参与", body }).eventType).toBe("result");
  });

  it.each([
    "很遗憾，您未能通过本次笔试。",
    "很遗憾地通知您，暂时无法进入下一轮面试。",
    "很抱歉，您的背景与岗位要求暂不匹配。",
  ])("%s", (body) => {
    expect(classifyEventType({ subject: "通知", body }).eventType).toBe("result");
  });

  it("条件句里的「很遗憾」说的是后果，不是结论：照样是笔试", () => {
    const body = "请于 10 月 20 日 19:00 参加在线笔试。如未按时参加，很遗憾将无法进入下一环节。";
    expect(classifyEventType({ subject: "笔试通知", body }).eventType).toBe("assessment");
  });

  it("面试邀请不受影响", () => {
    expect(classifyEventType({ subject: "面试邀请", body: "诚邀你参加 10 月 22 日的视频面试。" }).eventType).toBe("interview");
  });
});

describe("排版实体", () => {
  it("&ldquo;不匹配&rdquo; 还原成中文引号", () => {
    expect(decodeHtmlEntities("任何一次短暂的&ldquo;不匹配&rdquo;都不能掩盖住你的光芒&hellip;")).toBe("任何一次短暂的“不匹配”都不能掩盖住你的光芒…");
  });
});
