-- 增长统计（10/20）：注册来源、会员等级。

-- 注册时从哪来的（只记第一次、只记注册那一刻）：
--   signup_channel  链接或短网址里带的渠道标记（xhs、github……，见 channels.json）
--   signup_campaign 链接里的 c=（哪一篇帖子 / 哪个活动）
--   signup_referrer 从别的网站点进来时，那个网站的域名（只记域名）
--   signup_answer   注册后那道「你是从哪知道准点的」的回答；skip = 跳过了
ALTER TABLE users ADD COLUMN signup_channel TEXT;
ALTER TABLE users ADD COLUMN signup_campaign TEXT;
ALTER TABLE users ADD COLUMN signup_referrer TEXT;
ALTER TABLE users ADD COLUMN signup_answer TEXT;

-- 会员等级：现在所有人都是 free。给以后的付费 / 会员功能留位置，统计从第一天起就能按它分组。
ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
