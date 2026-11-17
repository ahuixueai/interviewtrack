import { describe, expect, it } from "vitest";
import { dayGroups } from "@/components/demo/AgendaView";
import { readyToConfirm } from "@/components/demo/Board";
import type { AgendaItem } from "@/lib/demo/agenda";
import { describeWhen, isLateNight, sourceTimeLine, timeSummary } from "@/lib/demo/parseDemo";
import type { DemoResult } from "@/lib/demo/parseDemo";

const NY = "America/New_York";
const BJ = "Asia/Shanghai";
// 2026-11-02 12:00 纽约（冬令时，UTC-5）
const NOW = Date.parse("2026-11-02T17:00:00Z");

function result(utc: string | null, dueType: DemoResult["dueType"], timeZone: string | null = BJ): DemoResult {
  return {
    dueType,
    timeZone,
    when: utc === null ? null : describeWhen(utc, timeZone, NY),
    unzoned: null,
  } as unknown as DemoResult;
}

function item(id: string, r: DemoResult): AgendaItem {
  return { id, key: id, result: r } as unknown as AgendaItem;
}

describe("日程按时间排，按天分组", () => {
  it("最急的在最上面，不管是什么类型；没有时间的放最后", () => {
    const groups = dayGroups(
      [
        item("exam-11-04", result("2026-11-04T11:00:00Z", "fixed_start")),
        item("untimed", result(null, "unknown")),
        item("deadline-today", result("2026-11-02T23:00:00Z", "deadline")),
        item("interview-11-03", result("2026-11-03T15:00:00Z", "fixed_start")),
      ],
      NY,
      NOW,
    );
    expect(groups.map((g) => [g.title, g.items.map((i) => i.id)])).toEqual([
      ["今天 · 11月2日 周一", ["deadline-today"]],
      ["明天 · 11月3日 周二", ["interview-11-03"]],
      ["11月4日 周三", ["exam-11-04"]],
      ["没有具体时间", ["untimed"]],
    ]);
  });
});

describe("卡片上的原时间和凌晨标记", () => {
  it("北京 14:00 = 纽约凌晨 01:00：标凌晨，写原来的北京时间", () => {
    const r = result("2026-11-05T06:00:00Z", "fixed_start");
    expect(isLateNight(r)).toBe(true);
    // 两地同一天（11月5日），只写钟点
    expect(sourceTimeLine(r)).toBe("= 北京时间 14:00");
  });

  it("跨了天带日期；截止带「前」；截止不标凌晨；同一时区不写", () => {
    const r = result("2026-11-05T03:00:00Z", "deadline");
    expect(isLateNight(r)).toBe(false);
    expect(sourceTimeLine(result("2026-11-05T01:00:00Z", "fixed_start"))).toBe("= 北京时间 11月5日 周四 09:00");
    const sameDay = result("2026-11-05T00:30:00Z", "deadline");
    // 纽约 11月4日 19:30，北京 11月5日 08:30：跨天，带日期
    expect(sourceTimeLine(sameDay)).toBe("= 北京时间 11月5日 周四 08:30 前");
    expect(sourceTimeLine(result("2026-11-05T15:00:00Z", "fixed_start", NY))).toBeNull();
  });

  it("下午的场次不标凌晨；时区不明不写原时间", () => {
    expect(isLateNight(result("2026-11-05T19:00:00Z", "fixed_start"))).toBe(false);
    expect(sourceTimeLine(result("2026-11-05T19:00:00Z", "fixed_start", null))).toBeNull();
  });
});

describe("待确认一键放进日程", () => {
  it("时间和时区都有才能一键放；缺了的要打开表单", () => {
    expect(readyToConfirm(item("a", result("2026-11-05T06:00:00Z", "fixed_start")))).toBe(true);
    expect(readyToConfirm(item("b", result("2026-11-05T06:00:00Z", "deadline")))).toBe(true);
    expect(readyToConfirm(item("c", result(null, "unknown")))).toBe(false);
    expect(readyToConfirm(item("d", result("2026-11-05T06:00:00Z", "fixed_start", null)))).toBe(false);
  });
});

describe("只知道日期的事", () => {
  it("不显示换算出来的假钟点，按信里那一天写", () => {
    // 北京 11月1日 零点 = 纽约 10月31日 12:00（夏令时）
    const r = result("2026-10-31T16:00:00Z", "date_only");
    expect(timeSummary(r, NY)).toEqual({ text: "11月1日 周日 · 只知道日期", zone: null });
    expect(dayGroups([item("d", r)], NY, NOW)[0]?.title).toBe("11月1日 周日");
  });
});
