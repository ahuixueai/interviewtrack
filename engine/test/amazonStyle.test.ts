import { describe, expect, it } from "vitest";
import { findRelativeDeadline } from "../src/relative.js";
import { parseEmail, StubExtractor } from "../src/index.js";

// 合成样本：照着亚马逊这类英文测评邀请的通用结构写的，名字和跟踪链接 ID 都是编的
const BODY = [
  "Hi there,",
  "",
  "Thank you for your interest in Amazon! The next step of the application process is the online assessment. Please complete this online assessment in the next week. If you do not complete you will not move forward in the hiring process.",
  "",
  "Do not click the Start My Assessment link below until you're ready to start and complete the assessment.",
  "",
  "You can find more information on assessments at Amazon here: https://www.amazon.jobs/en/landing_pages/assessments（https://t1.r.us-west-2.awstrack.me/L0/https:%2F%2Fwww.amazon.jobs%2Fen%2Flanding_pages%2Fassessments/1/0101-x/abc=474）",
  "",
  "If you have a disability and need a workplace accommodation, please visit https://amazon.jobs/content/en/how-we-hire/accommodations（https://t1.r.us-west-2.awstrack.me/L0/https:%2F%2Famazon.jobs%2Fcontent%2Fen%2Fhow-we-hire%2Faccommodations/1/0101-y/def=474）",
  "",
  "Start My Assessment（https://t1.r.us-west-2.awstrack.me/L0/https:%2F%2Fassess.example%2Fs%2Fq9/1/0101-z/ghi=474）",
].join("\n");

const RECEIVED = "2026-11-02T15:00:00Z";

describe("亚马逊这类英文测评邀请（AI 没响应时也要认得出）", () => {
  it("发件域名 mail.amazon.jobs 认出亚马逊；「in the next week」算出 7 天后截止；入口是 Start My Assessment", async () => {
    const out = await parseEmail(
      { id: "a", from: "Amazon <noreply@mail.amazon.jobs>", to: "", subject: "Action Required for your AWS Application - Complete Assessment", body: BODY, receivedAtUtc: RECEIVED },
      { extractor: new StubExtractor() },
    );
    if (out.kind !== "parsed") throw new Error("should parse");
    expect(out.event.company).toBe("亚马逊");
    expect(out.event.eventType).toBe("assessment");
    expect(out.event.dueType).toBe("deadline");
    expect(Date.parse(out.event.startUtc ?? "") - Date.parse(RECEIVED)).toBe(7 * 86_400_000);
    const links = out.trace.action.linkDetails;
    expect(links[0]).toMatchObject({ kind: "entry", label: "Start My Assessment" });
    // 跟踪链接是前面网址的副本，不重复列
    expect(links.map((l) => l.url)).toEqual([
      "https://t1.r.us-west-2.awstrack.me/L0/https:%2F%2Fassess.example%2Fs%2Fq9/1/0101-z/ghi=474",
      "https://www.amazon.jobs/en/landing_pages/assessments",
      "https://amazon.jobs/content/en/how-we-hire/accommodations",
    ]);
  });
});

describe("不写数字的英文期限", () => {
  it.each([
    ["Please complete the assessment in the next week.", 7],
    ["Please complete it within one week.", 7],
    ["Submit your video within a day.", 1],
    ["Please complete the test over the next 3 days.", 3],
  ])("%s", (text, days) => {
    expect(findRelativeDeadline(text)?.ms).toBe(days * 86_400_000);
  });

  it("「我们一周内回复你」不是你的期限", () => {
    expect(findRelativeDeadline("Please complete the form. We will get back to you within one week.")).toBeNull();
  });
});
