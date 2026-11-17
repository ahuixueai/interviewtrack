import { describe, expect, it } from "vitest";
import { extractActionInfo, extractCredentials, extractLinkDetails, extractLinks } from "../src/actionInfo.js";

// 全部是合成文本，域名用保留的 .example
describe("extractLinks", () => {
  it("摘出链接，不把后面的中文标点吃进去", () => {
    expect(extractLinks("测评链接：https://assess.beichen.example/a/7f3k2，请尽快完成。")).toEqual([
      "https://assess.beichen.example/a/7f3k2",
    ]);
  });

  it("句末的半角标点不属于链接", () => {
    expect(extractLinks("Start here: https://exam.example/t/abc123.")).toEqual([
      "https://exam.example/t/abc123",
    ]);
    expect(extractLinks("(see https://exam.example/t/abc123)")).toEqual(["https://exam.example/t/abc123"]);
  });

  it("保留查询参数", () => {
    expect(extractLinks("点击 https://exam.example/start?id=42&token=Ab9x 开始")).toEqual([
      "https://exam.example/start?id=42&token=Ab9x",
    ]);
  });

  it("退订、隐私政策这类页脚链接不要", () => {
    expect(
      extractLinks(
        "测评入口 https://assess.example/go/1 \n退订 https://mail.example/unsubscribe?u=1 隐私 https://corp.example/privacy",
      ),
    ).toEqual(["https://assess.example/go/1"]);
  });

  it("有入口提示词的排在前面", () => {
    const text = "公司官网 https://corp.example/about-us 。请点击链接开始作答：https://assess.example/go/1";
    expect(extractLinks(text)).toEqual(["https://assess.example/go/1", "https://corp.example/about-us"]);
  });

  it("同一个链接出现两次只留一个，最多五个", () => {
    expect(extractLinks("https://a.example/x1 https://a.example/x1")).toEqual(["https://a.example/x1"]);
    const many = Array.from({ length: 8 }, (_, i) => `https://a.example/page${i}`).join(" ");
    expect(extractLinks(many)).toHaveLength(5);
  });

  it("没有链接返回空", () => {
    expect(extractLinks("请留意后续通知")).toEqual([]);
    expect(extractLinks("")).toEqual([]);
  });
});

// 合成样本：照着牛客笔试通知的通用结构写的，公司、链接 ID 都是编的
const NOWCODER_STYLE = [
  "现诚邀您参加在线笔试，请仔细阅读以下考试须知，按时参加笔试。",
  "",
  "点击确认是否参加考试（https://hr.nowcoder.com/v1/s/Cnf1rmAb#）",
  "",
  "考试时间：(北京时间，UTC+08:00)  2026-11-05 19:00:00 -- 21:00:00",
  "",
  "考试地址： https://hr.nowcoder.com/v1/s/Ex4mLink# （考试地址为您的私人专属地址，请勿转发。）",
  "",
  "请使用最新版Chrome浏览器访问笔试网址，最新版浏览器下载地址： https://www.nowcoder.com/discuss/3793",
  "",
  "在线作答编程，需要自己处理输入输出，建议你进行在线oj输入输出练习（https://www.nowcoder.com/link/acm_oj_test#question）",
  "。",
  "为提前熟悉考试环境，建议提前在题库模拟练习：进入考前模拟题库（https://www.nowcoder.com/exam/oj?page=1&topicId=389） 。",
  "",
  "www.nowcoder.com（http://www.nowcoder.com）",
].join("\n");

describe("extractLinkDetails：一封信好几个链接", () => {
  it("牛客笔试通知：考试地址排第一，确认参加第二，练习和下载往后放", () => {
    expect(extractLinkDetails(NOWCODER_STYLE)).toEqual([
      { url: "https://hr.nowcoder.com/v1/s/Ex4mLink", kind: "entry", label: "考试地址" },
      { url: "https://hr.nowcoder.com/v1/s/Cnf1rmAb", kind: "confirm", label: "确认是否参加考试" },
      { url: "https://www.nowcoder.com/link/acm_oj_test#question", kind: "practice", label: "在线oj输入输出练习" },
      { url: "https://www.nowcoder.com/exam/oj?page=1&topicId=389", kind: "practice", label: "考前模拟题库" },
      { url: "https://www.nowcoder.com/discuss/3793", kind: "info", label: "最新版浏览器下载地址" },
    ]);
  });

  it("链接独占一行时，看上一行怎么叫它", () => {
    expect(extractLinkDetails("面试会议链接：\nhttps://meet.example/j/abc123")).toEqual([
      { url: "https://meet.example/j/abc123", kind: "entry", label: "面试会议链接" },
    ]);
  });

  it("模拟考试链接是练习，不是入口", () => {
    const text = "模拟考试链接：https://exam.example/mock/1\n正式考试链接：https://exam.example/s/2";
    expect(extractLinkDetails(text).map((d) => [d.kind, d.label])).toEqual([
      ["entry", "正式考试链接"],
      ["practice", "模拟考试链接"],
    ]);
  });

  it("只剩末尾的 # 去掉，真正的 #片段保留", () => {
    expect(extractLinks("考试地址：https://exam.example/s/abc#")).toEqual(["https://exam.example/s/abc"]);
    expect(extractLinks("练习：https://exam.example/p#q1")).toEqual(["https://exam.example/p#q1"]);
  });

  it("英文信也能分", () => {
    const text = "Please confirm your attendance: https://ats.example/rsvp/9\nJoin the interview: https://zoom.example/j/123456";
    expect(extractLinkDetails(text).map((d) => [d.kind, d.label])).toEqual([
      ["entry", "Join the interview"],
      ["confirm", "Please confirm your attendance"],
    ]);
  });

  it("links 和 linkDetails 同序", () => {
    const info = extractActionInfo(NOWCODER_STYLE);
    expect(info.links).toEqual(info.linkDetails.map((d) => d.url));
  });
});

describe("extractCredentials", () => {
  it.each([
    ["测评密钥：BC-7Q2M-91XK", "测评密钥", "BC-7Q2M-91XK"],
    ["考试码为 XH20261015", "考试码", "XH20261015"],
    ["邀请码: a8f3k2", "邀请码", "a8f3k2"],
    ["Access code: 4F9-K2P7", "Access code", "4F9-K2P7"],
    ["Your passcode is 827364", "passcode", "827364"],
    ["初始密码：Xh@2026", "初始密码", "Xh@2026"],
    ["Password: Ab12cd.", "Password", "Ab12cd"],
  ])("%s", (text, label, value) => {
    expect(extractCredentials(text)).toEqual([{ label, value }]);
  });

  it("「测评密钥」整个作为标签，不只匹配到「密钥」", () => {
    expect(extractCredentials("测评密钥：K9M2-77QA")[0]?.label).toBe("测评密钥");
  });

  it("会议号带空格或连字符分组", () => {
    expect(extractCredentials("腾讯会议，会议号：123 456 789，会议密码 4821")).toEqual([
      { label: "会议号", value: "123 456 789" },
      { label: "会议密码", value: "4821" },
    ]);
    expect(extractCredentials("Meeting ID: 987-654-3210")[0]).toEqual({
      label: "Meeting ID",
      value: "987-654-3210",
    });
  });

  it("纯字母的不当凭据：多半是普通单词", () => {
    expect(extractCredentials("如忘记密码 请联系管理员")).toEqual([]);
    expect(extractCredentials("password reset instructions")).toEqual([]);
  });

  it("登录验证码不摘", () => {
    expect(extractCredentials("你的验证码是 384920，10 分钟内有效")).toEqual([]);
  });

  it("同一个值只留一次，最多四条", () => {
    expect(extractCredentials("密钥：AB12CD34，再次提醒密钥：AB12CD34")).toHaveLength(1);
    const many = Array.from({ length: 6 }, (_, i) => `邀请码：CODE${i}00${i}`).join("；");
    expect(extractCredentials(many)).toHaveLength(4);
  });
});

describe("extractActionInfo", () => {
  it("一封典型的测评邀请", () => {
    const text = [
      "请在 72 小时内完成在线测评。",
      "测评链接：https://assess.beichen.example/a/7f3k2",
      "测评密钥：BC-7Q2M-91XK",
    ].join("\n");
    expect(extractActionInfo(text)).toEqual({
      links: ["https://assess.beichen.example/a/7f3k2"],
      linkDetails: [{ url: "https://assess.beichen.example/a/7f3k2", kind: "entry", label: "测评链接" }],
      credentials: [{ label: "测评密钥", value: "BC-7Q2M-91XK" }],
    });
  });

  it("什么都没有时是空数组", () => {
    expect(extractActionInfo("我们已收到你的申请")).toEqual({ links: [], linkDetails: [], credentials: [] });
  });
});
