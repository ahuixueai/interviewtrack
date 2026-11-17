-- 后台统计（10/20）：每天、每个人、每类事件发生了几次。只记次数，不记任何邮件内容。
-- 被丢掉的（不像招聘信）和被拒收的信不进 emails 表，不记在这里就无从知道收信是不是出了问题。
-- 90 天后自动删掉（定时任务）。
CREATE TABLE daily_stats (
  day     TEXT NOT NULL,             -- UTC 日期 YYYY-MM-DD
  user_id TEXT NOT NULL,             -- 空串 = 认不出是谁的（发到不存在的收信地址）
  metric  TEXT NOT NULL,             -- 见 src/stats.ts 的 Metric
  source  TEXT NOT NULL DEFAULT '',  -- 收信：从哪家邮箱转来（gmail / qq / netease / outlook / other）；其余为空
  n       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, user_id, metric, source)
);

-- 最近一次打开看板的时刻（每小时最多更新一次）。后台用来看谁在用。
ALTER TABLE users ADD COLUMN last_seen_at TEXT;
