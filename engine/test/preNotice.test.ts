import { describe, expect, it } from "vitest";
import { classifyEventType } from "../src/eventType.js";
import { parseEmail, StubExtractor } from "../src/index.js";

// 合成样本：照着笔试预通知的常见结构写的，公司、岗位都是编的
const BODY = [
  "你好，",
  "感谢你对北风科技的关注！",
  "你已经通过了简历筛选，北风科技即将邀请你进入在线测试环节！请仔细阅读以下信息并做好准备，谢谢。",
  "正式在线测试链接于北京时间2026年11月1日发送至你的邮箱，邮件主题“Action Required for your Northwind Application—Complete Assessment”，请注意查收邮箱。通知邮件中要求于收到邮件后7天内完成。",
  "在线测试组成：技术模拟：需要 40 分钟。",
  "如果你无法在按时进行在线测试，请务必于测试到期之前回复邮件告知，邮件主题为“笔试+姓名+邮箱+调整日期“，示例“笔试+张三+zhangsan@mail.example+调整至xx月xx日”，具体原因请写在正文内。我们会视情况决定是否另行安排补测。",
].join("\n");

describe("笔试预通知", () => {
  it("认成测评的预通知：不是改期，不取「发链接那天」当时间", async () => {
    const c = classifyEventType({ subject: "【北风科技2027校园招聘】笔试预通知，产品运营", body: BODY });
    expect(c.eventType).toBe("assessment");
    expect(c.preNotice).toBe(true);
    expect(c.shouldMerge).toBe(false);

    const out = await parseEmail(
      { id: "p", from: "Northwind Campus <campus@northwind.example>", to: "", subject: "【北风科技2027校园招聘】笔试预通知，产品运营", body: BODY, receivedAtUtc: "2026-10-30T02:00:00Z" },
      { extractor: new StubExtractor() },
    );
    if (out.kind !== "parsed") throw new Error("should parse");
    expect(out.event.dueType).toBe("unknown");
    expect(out.event.startUtc).toBeNull();
    expect(out.trace.eventType.preNotice).toBe(true);
  });

  it("正式邀请里一句「请注意查收」不算预通知", () => {
    const c = classifyEventType({ subject: "笔试邀请", body: "请于 11 月 5 日 19:00 参加在线笔试，考试链接已发送，请注意查收。" });
    expect(c.preNotice).toBeUndefined();
  });

  it("真的改期照样认", () => {
    const c = classifyEventType({ subject: "面试时间调整", body: "原定 11 月 3 日的面试调整至 11 月 5 日 14:00。" });
    expect(c.shouldMerge).toBe(true);
    expect(c.reason).toContain("改期");
  });
});
