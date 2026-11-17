// 生成物：由 scripts/sync-tracker-core.mjs 从 engine/src 同步而来，不要手改。
import type { Confidence, EventType } from "./types";
import { normalizeText } from "./text";
import { isVerificationNoise } from "./noise";

/**
 * 事件类型分类。
 *
 * dedup.ts 的 dedupKey 依赖调用方给出正确的 eventType，1.2 一接上收信管线
 * 就必须用——这是继时区推断之后第二个「现在不写、以后必然现写、现写必然
 * 糊」的模块。
 */

export interface EventTypeSignals {
  subject: string;
  body: string;
  /** 发件域名。目前只用来认招聘网站的群发推荐（智联、前程无忧、猎聘）。 */
  senderDomain?: string;
}

export interface EventTypeClassification {
  eventType: EventType;
  /** 是否需要用户行动，决定要不要提醒和进日历。 */
  actionable: boolean;
  /** 是否应合并到已有事件而非新建。 */
  shouldMerge: boolean;
  /**
   * 这封信在说**哪一类事**。催办和改期邮件本身不是事件，是对已有事件的又一次
   * 提及——「重复提醒：京东笔试 0815 场」说的是那场笔试，不是一件叫「提醒」的事。
   *
   * eventType 描述**这封邮件是什么**（外部用例集要求催办判 reminder），
   * mergeAs 描述**它在说哪件事**。去重键要用后者，否则催办会另起一条记录，
   * 正是 baseline 第 2 节那个「同一场笔试存成两条」的原始缺陷。
   * 认不出被提醒的是什么事时为 null，此时只能当独立记录处理。
   */
  mergeAs: EventType | null;
  confidence: Confidence;
  /** 判定依据，便于人工复核。 */
  reason: string;
  /**
   * 规则**确定**这不是流程里的一步（问卷、宣讲会、招聘网站推荐…），不是「没认出来」。
   * 管线据此不采纳模型的类型建议——否则模型一句「这是面试」，广告就带着「待确认」挤进你的收件箱。
   */
  final?: boolean;
  /**
   * 预通知：「正式测试链接将于 11 月 1 日发送至你的邮箱」。说的是**以后会来一封**正式邀请，
   * 信里的日期是发链接的日子，不是考试或截止。管线据此不取时间、不排进日程，只记进投递表。
   */
  preNotice?: boolean;
}

/** actionable 完全由 eventType 决定，见方案对「行动项 vs 通知」的划分。 */
const ACTIONABLE: Readonly<Record<EventType, boolean>> = {
  application_ok: false,
  assessment: true,
  interview: true,
  result: false,
  reminder: true,
  update: true,
  other: false,
};


/**
 * 五类正文信号词，按优先级从高到低排列。
 *
 * 顺序本身就是判定逻辑：命中即停，第一个匹配的类别赢。这天然实现了
 * 「行动项优先于结果通知」——assessment/interview/update 排在 result 前面，
 * 一封「恭喜通过初筛，请完成在线测评」的邮件在测到「测评」的瞬间就已经
 * 判定为 assessment，根本不会走到 result 分支去看「恭喜」「通过」这些词。
 * 不需要额外写一条「行动 vs 结果冲突时怎么办」的规则，顺序本身就是规则。
 */
const CATEGORY_ORDER: ReadonlyArray<readonly [EventType, RegExp]> = [
  [
    "assessment",
    /测评|笔试|试卷|\bassessment\b|skills\s+assessment|online\s+test|coding\s+(?:challenge|test)|technical\s+test|aptitude\s+test|take[-\s]home\s+(?:assignment|test|exercise)|\b(?:HackerRank|Codility|CodeSignal)\b/i,
  ],
  [
    "interview",
    /面试|视频面试|群面|终面|初面|一面|二面|三面|\binterview\b|phone\s+screen(?:ing)?|screening\s+call|recruiter\s+(?:call|screen)|\bsuperday\b|\bHireVue\b/i,
  ],
  [
    "update",
    /更新简历|补充简历|完善简历|补充信息|(?:更新|完善|补充)(?:或补充)?.{0,12}(?:简历信息|应聘信息|个人信息|申请表|登记表)|update\s+your\s+(resume|profile)|complete\s+your\s+profile|provide\s+additional\s+information/i,
  ],
  /**
   * 英文的**明确决定**排在 application_ok 之前。
   *
   * 英文拒信几乎都以「Thank you for applying / for your application」开头，
   * 不提前拦一道就会被下面的 application_ok 抢走——把一封拒信显示成「投递成功」。
   * 这里只放不会以条件句形式出现在回执里的强表述；「if you are not selected…」
   * 这类回执常用的条件句故意不收，否则回执会反过来被判成结果。
   */
  [
    "result",
    /regret\s+to\s+inform|(?:will|are|have\s+decided)\s+not\s+(?:to\s+)?(?:be\s+)?(?:mov(?:e|ing)|proceed(?:ing)?|progress(?:ing)?)\s+forward|not\s+(?:be\s+)?(?:moving|proceeding|progressing)\s+(?:forward\s+)?with\s+your|(?:move|proceed|moving|proceeding)\s+forward\s+with\s+other\s+candidates|unable\s+to\s+offer\s+you|offer\s+of\s+employment|pleased\s+to\s+(?:offer|extend)/i,
  ],
  [
    "application_ok",
    /已收到你的申请|已收到您的申请|已收到(?:你|您)对.{1,40}?的(?:申请|投递)|简历已收到|已成功投递|投递成功|投递确认|进入评估流程|收到(你|您)的(简历|申请)|thank\s+you\s+for\s+your\s+application|successful\s+application|we\s+will\s+review\s+(it|your\s+application)|(?:thank\s+you|thanks)\s+for\s+applying|received\s+your\s+application|application\s+(?:has\s+been\s+|was\s+)?(?:received|submitted)/i,
  ],
  [
    "result",
    /很遗憾|遗憾的是|很抱歉地?通知|未通过|暂不匹配|无法进入.{0,10}下一(?:阶段|环节|轮)|暂时无法.{0,6}继续前进|不再(推进|继续)|not\s+to\s+move\s+forward|decided\s+not\s+to|录用意向|offer\s+letter|发出录用|pleased\s+to\s+(offer|extend)/i,
  ],
];

/**
 * 明确的拒绝，要排在「测评 / 面试」之前看。
 *
 * 一封真实的拒信：「很抱歉暂时无法为你安排后续环节……希望未来或有机会邀请你参加其他岗位的面试」。
 * 按类别顺序扫，「面试」两个字先命中，一封拒信就成了「面试（形式未说明）」摆进待确认。
 * 拒绝说的是**这一次的结论**，后面提到的面试、测评是以后的可能，不是要你去做的事。
 *
 * 只收不会出现在邀请里的强表述，并且挡掉条件句：
 * 「如未按时完成，很遗憾将无法进入下一环节」说的是后果，不是结论。
 */
const STRONG_REJECTION =
  /(?:很抱歉|很遗憾|遗憾地)[^。！!？?\n]{0,12}?(?:暂时|暂|目前)?(?:无法|不能|未能)(?:为你|为您|给你|给您)?(?:安排|进入|继续|推进)[^。！!？?\n]{0,4}?(?:后续|下一|下轮|面试|笔试|流程|环节)|无法为(?:你|您)安排后续|(?:很遗憾|很抱歉)[^。！!？?\n]{0,20}?(?:未能通过|没有通过|未通过|未被录用|未入选|不匹配)/;
const CONDITIONAL_BEFORE = /如果|若|如未|如您未|如你未|如逾期|否则|逾期|未按时|未在规定/;

function strongRejection(text: string): string | null {
  const m = STRONG_REJECTION.exec(text);
  if (!m) return null;
  const sentenceStart = Math.max(...["。", "！", "!", "？", "?", "\n"].map((c) => text.lastIndexOf(c, m.index))) + 1;
  if (CONDITIONAL_BEFORE.test(text.slice(sentenceStart, m.index + m[0].length))) return null;
  return m[0];
}

/**
 * 信里**提到**一个环节，不等于这封信**是**那个环节（2026-11-10 样本外评测）。
 *
 * 按词扫正文时，下面三种「提到」会抢走真正的结论，扫之前先遮掉：
 * - 上一轮的客套：「Thank you for attending our recent assessment」「感谢您参加在线笔试」
 * - 做完的确认：「your assessment was successfully submitted」
 * - 以后的安排：「笔面试将滚动安排」「后续面试将另行通知」——必须带「滚动 / 另行 / 后续」这类词，
 *   而且中间不能有数字：「面试将于 10 月 20 日 14:00 进行」是真的日程，不遮
 *
 * 遮掉之后什么都不剩时，退回没遮的正文再扫一遍（见 scanCategory）：
 * 「感谢您参加某公司在线测评环节，请于 3 天内完成」里的「参加」是现在要做，不是客套。
 */
const MENTION_ONLY: readonly RegExp[] = [
  /thank(?:s|\s+you)\s+for\s+(?:taking\s+the\s+time\s+to\s+)?(?:attend(?:ing)?|complet(?:e|ing)|tak(?:e|ing)|participat(?:e|ing)\s+in)\b[^.!?\n]{0,60}/gi,
  /(?:assessment|test)\s+(?:was|has\s+been)\s+successfully\s+(?:submitted|completed)/gi,
  /感谢(?:您|你)?(?:参加|完成|参与)[^。！!？?\n，,]{0,30}/g,
  /(?:笔面试|笔试|面试|测评)[^。；;！!\n，,\d]{0,10}?(?:将|会)[^。；;！!\n，,\d]{0,8}?(?:滚动|陆续|另行|另外|后续|稍后)[^。；;！!\n，,\d]{0,6}?(?:安排|通知|开展|进行|发送)/g,
];

function maskMentions(text: string): string {
  let out = text;
  for (const pattern of MENTION_ONLY) out = out.replace(pattern, (m) => " ".repeat(m.length));
  return out;
}

/**
 * 「已提交」的确认：「Thank you for completing your Assessment」。
 * 正文满篇 assessment，但它说的是做完了，不是又一场测评。
 * 遮掉客套和确认之后还剩测评 / 面试的（「做完了，下一步请参加面试」）不算。
 */
const COMPLETION_CONFIRMATION =
  /thank(?:s|\s+you)\s+for\s+(?:taking\s+the\s+time\s+to\s+)?(?:complet(?:e|ing)|submitting)\b[^.!?\n]{0,60}(?:assessment|test)|(?:assessment|test)\s+(?:was|has\s+been)\s+successfully\s+(?:submitted|completed)/i;

function isCompletionConfirmation(subject: string, body: string): boolean {
  if (!COMPLETION_CONFIRMATION.test(subject) && !COMPLETION_CONFIRMATION.test(body)) return false;
  const rest = `${maskMentions(subject)} ${maskMentions(body)}`;
  return !CATEGORY_ORDER.some(([type, pattern]) => (type === "assessment" || type === "interview") && pattern.test(rest));
}

/**
 * 标题明写「面试邀请」「笔试通知」，而且正文里也确实在说这件事：按标题说的那一步算。
 *
 * 类别顺序里测评排在面试前面，于是一封「经理面试邀请函」只要正文出现一次 assessment
 *（「next stage of the assessment process」）就会被判成测评。
 * 仍然要求正文里读得出同一类——标题写测评、正文其实是 AI 面试的那种标题党照旧按正文判。
 * 标题同时写了两类的不用这条。
 */
const SUBJECT_INVITE: ReadonlyArray<readonly [EventType, RegExp]> = [
  ["interview", /面试(?:邀请|邀约|通知|安排)|interview\s+invitation|invitation\s+(?:to|for)\s+(?:an?\s+|the\s+)?interview/i],
  [
    "assessment",
    /(?:笔试|测评|测试)(?:邀请|邀约|通知|安排)|(?:assessment|test)\s+invitation|invitation\s+(?:to|for)\s+(?:an?\s+|the\s+)?(?:online\s+)?(?:assessment|test)/i,
  ],
];

function subjectInvite(subject: string, body: string): readonly [EventType, RegExp] | null {
  const named = SUBJECT_INVITE.filter(([, pattern]) => pattern.test(subject));
  if (named.length !== 1) return null;
  const type = named[0]![0];
  const entry = CATEGORY_ORDER.find(([t]) => t === type);
  return entry && entry[1].test(body) ? entry : null;
}

/**
 * 正文优先于标题：body 是唯一的判定来源，命中即用；body 什么都没命中
 * 才退回标题。这条顺序关系不是「加权」，是硬优先级——
 *
 * baseline 的真实反例：有一封信标题写「测评邀请」，正文其实是 AI 视频
 * 面试。如果把标题和正文拼在一起统一计数，「测评」（标题里 1 次）会跟
 * 「面试」（正文里 2 次）搅在一起，结果对不对全凭巧合的出现次数。
 * body-first 让这类「标题党」邮件失效：正文里读不出「测评」，
 * 无论标题怎么写都不会被判成 assessment。
 */
function scanCategory(subject: string, body: string): readonly [EventType, RegExp] | null {
  // 先扫遮掉「只是提到」之后的正文；什么都不剩时再看标题，最后才退回没遮的正文
  const masked = maskMentions(body);
  for (const entry of CATEGORY_ORDER) {
    if (entry[1].test(masked)) return entry;
  }
  for (const entry of CATEGORY_ORDER) {
    if (entry[1].test(subject)) return entry;
  }
  if (masked !== body) {
    for (const entry of CATEGORY_ORDER) {
      if (entry[1].test(body)) return entry;
    }
  }
  return null;
}

/**
 * 改期通知：本质是「原事件的更新」，应合并到原事件并覆盖时间，
 * 而不是新建一条 update。分类结果是「被改期的那个事件类型」
 * （面试改期还是面试，不会因为改期就变成 update），但强制 shouldMerge=true。
 */
const RESCHEDULE_MARK = /时间调整|调整至|改期|重新安排|reschedul(?:e|ing|ed)|原定.{0,30}(?:调整|改)/g;

/**
 * 真的是改期通知，而不是「如果你没法按时参加，请回信申请调整至 xx 月 xx 日」这种须知。
 * 有一封笔试预通知就是后一种：一封正常的通知被当成了改期，合并去覆盖原来的时间。
 * 所在句子带条件词或「xx 月」这类占位符的不算。
 */
const RESCHEDULE_NOT_REAL = /如果|若|如需|如无法|如你无法|如您无法|如不能|无法按时|示例|例如|[xX×]{1,2}\s*月|[xX×]{1,2}\s*日/;

function isReschedule(text: string): boolean {
  for (const m of text.matchAll(RESCHEDULE_MARK)) {
    const start = Math.max(...["。", "！", "!", "？", "?", "\n"].map((c) => text.lastIndexOf(c, m.index))) + 1;
    const ends = ["。", "！", "!", "？", "?", "\n"].map((c) => text.indexOf(c, m.index)).filter((i) => i >= 0);
    const end = ends.length > 0 ? Math.min(...ends) : text.length;
    if (!RESCHEDULE_NOT_REAL.test(text.slice(start, end))) return true;
  }
  return false;
}

/**
 * 预通知：正式的测评 / 面试邀请还没发，这封只是告诉你「会来、注意查收」。
 * 要同时有「之后会发 / 即将邀请」的意思，免得把正式邀请里一句「请注意查收」也算进来。
 */
const PRE_NOTICE =
  /预通知|即将(?:邀请|向你|向您|给你|给您)[^。\n]{0,10}(?:进入|参加)|(?:链接|邀请|邮件)[^。\n]{0,24}(?:将|会)于[^。\n]{0,30}发送(?:至|到|给)(?:你|您)|(?:将|会)于[^。\n]{0,30}(?:发送|发出)[^。\n]{0,12}(?:测试|测评|笔试|面试)(?:链接|邀请)/;

/**
 * 催办/紧急提醒：要么是明确的「提醒」前缀（重复提醒、Reminder:、Re:），
 * 要么是「即将到期」的紧迫框架（即将截止、N 小时后截止、已重置）。
 *
 * 「（第二次提醒）」这类夹在句尾的括注不算——那只是催办次数的标注，
 * 邮件本身说的事（补充简历信息）该是什么类型还是什么类型，不因为
 * 括注里出现了「提醒」二字就整体判成 reminder。所以「前缀式提醒」要求
 * 出现在文本开头，而不是全文任意位置搜「提醒」这个词。
 */
const LEAD_REMINDER = /^[【\[]?(?:重复提醒|再次提醒|reminder\s*[:：]|re\s*[:：])/i;
const URGENCY_OR_RESET =
  /即将截止|将于.{0,8}后截止|expires?\s+in\s+\d|starts?\s+in\s+\d|已重置|网络故障|link\s+has\s+expired/i;

function looksLikeReminder(subject: string, body: string): boolean {
  if (LEAD_REMINDER.test(subject.trim()) || LEAD_REMINDER.test(body.trim())) return true;
  return URGENCY_OR_RESET.test(subject) || URGENCY_OR_RESET.test(body);
}

/**
 * 标题点明「这是一张问卷」：面试体验满意度调查、候选人体验调研。
 *
 * 这类信的正文必然出现「面试」「测评」——它问的就是那场面试——而且常带
 * 「24 小时内完成问卷」这样的期限，于是会被判成一场有截止时间的面试摆上日程。
 * 它不是流程里的任何一步，填不填都不影响结果。只看标题，正文里顺带提到问卷的不算。
 */
const SURVEY_SUBJECT = /满意度|体验(?:调查|调研|反馈问卷)|问卷调查|调研问卷|(?:雇主|品牌)[^，,。]{0,6}调研|(?:satisfaction|experience)\s+survey/i;

/**
 * 标题是「请你评价这次面试」：面试后的评价邀请（「某公司诚邀你对本次面试进行评价」）。
 *
 * 和上面的问卷是一回事，只是不说「问卷」「调研」，说「评价」「打分」。
 * 标题和正文都满是「面试」，信里又没有时间，会被判成一场没写时间的面试摆进待确认（2026-11-16 真实情况）。
 *
 * 必须是「邀请 / 请 你……对……面试……评价」，或者「对本次面试……评价」这种指着刚结束那一场说的句式：
 * 「面试评价结果通知」是结果，「面试官将对你进行评价」是面试须知，都不能挡。只看标题。
 */
const RATING_INVITE_SUBJECT =
  /(?:邀请?|请)(?:你|您)?[^，,。]{0,4}对[^，,。]{0,10}(?:面试|笔试|测评)[^，,。]{0,6}(?:评价|打分|评分)|对(?:本次|此次|这次|本场|该次)(?:面试|笔试|测评)[^，,。]{0,6}(?:评价|打分|评分)/;

/**
 * 招聘方和招聘网站的**营销群发**：宣讲会、直播、双选会、「X 秋招开启」、岗位推荐、「邀您投递」。
 *
 * 它们满篇都是「面试」「笔试」「校招」「投递」，按词扫会被当成流程通知，模型也常跟着说「这是面试」；
 * 但它们说的是「来投我们」，不是你已经在走的流程里的一步。真实收件里这类信
 * 曾有 9 封进了待确认（宣讲会、平台推荐、调研、开放申请…）。
 *
 * 只看标题。分两档：
 * - STRONG_PROMO（宣讲会、直播、专场、「等你加入」…）：活动本身就是广告，标题里顺带一句「拿 offer」「投递成功」也不算你的流程
 *   （真实例子：「有机会现场拿offer！某矿业纽约专场即将开启！」「简历投递成功，应届生宝藏版块等你加入」）
 * - PROMO_SUBJECT：标题里明写了属于你的那一步（「笔试通知」「面试邀请」「投递成功」）就不算——见 PERSONAL_STEP。
 */
const STRONG_PROMO = /【智联推荐】|宣讲会|空宣|空中宣讲|直播|双选会|招聘会|专场|开放日|等你加入|宝藏|雇主品牌/;

const PROMO_SUBJECT =
  /邀您投递|投递邀请|岗位推荐|职位推荐|(?:校招|校园招聘|秋招|春招|实习生?招聘|管培生?招聘)[^，,。！!]{0,8}(?:开启|启动|来啦|来袭|开放|开始|进行中)|opportunities\s+(?:are\s+)?(?:now\s+)?open|applications?\s+(?:are\s+)?(?:now\s+)?open|now\s+hiring|we(?:'re|\s+are)\s+hiring|join\s+our\s+team/i;

/** 标题里明写了「你的」那一步：有这些就不是群发营销。 */
const PERSONAL_STEP =
  /(?:笔试|面试|测评|测试|评测)(?:通知|邀请|邀约|安排|提醒|结果)|投递成功|申请成功|提交成功|已收到(?:您|你)|诚邀你?进入|录用|offer\s+letter|很遗憾|未通过|不合适|感谢(?:您|你)的?(?:投递|应聘|申请)|your\s+(?:application|interview|assessment)|invitation\s+to\s+(?:interview|assessment)/i;

/** 招聘网站的群发域名（不是企业 ATS）：它们发的几乎全是岗位推荐和活动广告。 */
const JOB_BOARD_DOMAIN = /(?:^|\.)(?:wisdomore\.com|zhaopin\.(?:com|cn)|51job\.com|lietou-edm\.com|liepin\.com)$/i;

/**
 * 标题点明「要你补材料」：更新应聘信息、完善网申登记表、填写应聘登记表。
 *
 * 正文优先于标题这条原则（见 scanCategory）防的是标题党——标题写测评、正文是面试。
 * 补材料类正好反过来：标题说得很准，正文却几乎总会带一句「以免影响后续面试安排」
 * 「请在面试前完成」，被排在前面的 interview 抢走。所以这一类单独先看标题。
 */
const UPDATE_SUBJECT =
  /(?:更新|完善|补充|填写).{0,12}(?:简历|应聘信息|个人信息|登记表|申请表)|(?:登记表|申请表).{0,14}(?:填写|完善|更新)/;

export function classifyEventType(signals: EventTypeSignals): EventTypeClassification {
  const subject = normalizeText(signals.subject ?? "");
  const body = normalizeText(signals.body ?? "");
  const full = `${subject} ${body}`;

  const withActionable = (
    eventType: EventType,
    shouldMerge: boolean,
    confidence: Confidence,
    reason: string,
    mergeAs: EventType | null = null,
  ): EventTypeClassification => ({
    eventType,
    actionable: ACTIONABLE[eventType],
    shouldMerge,
    confidence,
    reason,
    mergeAs,
  });

  if (subject.trim().length === 0 && body.trim().length === 0) {
    return withActionable("other", false, "low", "空文本");
  }

  if (isVerificationNoise(subject, body)) {
    return withActionable("other", false, "low", "命中验证码/邮箱验证等非求职噪音");
  }

  if (SURVEY_SUBJECT.test(subject)) {
    return { ...withActionable("other", false, "low", "标题是满意度调查/问卷：不是流程里的一步"), final: true };
  }

  if (RATING_INVITE_SUBJECT.test(subject)) {
    return { ...withActionable("other", false, "low", "标题是请你评价刚结束的那场面试 / 笔试：不是流程里的一步"), final: true };
  }

  if (STRONG_PROMO.test(subject)) {
    return { ...withActionable("other", false, "low", "标题是宣讲会 / 直播 / 专场 / 平台推荐这类活动广告：不是你流程里的一步"), final: true };
  }

  if (!PERSONAL_STEP.test(subject)) {
    const domain = (signals.senderDomain ?? "").toLowerCase();
    if (PROMO_SUBJECT.test(subject)) {
      return { ...withActionable("other", false, "low", "标题是宣讲会 / 直播 / 开放申请 / 岗位推荐这类群发：不是你流程里的一步"), final: true };
    }
    if (domain.length > 0 && JOB_BOARD_DOMAIN.test(domain)) {
      return { ...withActionable("other", false, "low", `发件方是招聘网站群发（${domain}），标题也没写你的哪一步`), final: true };
    }
  }

  if (PRE_NOTICE.test(full)) {
    const about = scanCategory(subject, body)?.[0];
    if (about === "assessment" || about === "interview") {
      return {
        ...withActionable(about, false, "high", `预通知：正式的${about === "assessment" ? "测评" : "面试"}邀请还没发，信里的日期是发邀请的日子；等正式邮件来了再排日程`),
        preNotice: true,
      };
    }
  }

  const rejected = strongRejection(body) ?? strongRejection(subject);
  if (rejected !== null) {
    return withActionable("result", false, "high", `明确的拒绝：「${rejected}」；信里再提到面试、测评，说的是以后的机会`);
  }

  if (isCompletionConfirmation(subject, body)) {
    return { ...withActionable("other", false, "low", "「已提交 / 已完成」的确认：不是要你做的事"), final: true };
  }

  if (isReschedule(full)) {
    const underlying = scanCategory(subject, body);
    const type = underlying?.[0] ?? "update";
    return withActionable(
      type,
      true,
      "high",
      `改期通知：原事件类型为 ${type}，合并到已有事件并覆盖时间，而非新建`,
      type,
    );
  }

  if (looksLikeReminder(subject, body)) {
    const about = scanCategory(subject, body)?.[0] ?? null;
    return withActionable(
      "reminder",
      true,
      "high",
      about === null
        ? "催办/紧急提醒：但认不出在提醒哪一类事，只能作为独立记录"
        : `催办/紧急提醒：在提醒一件 ${about}，按该事件的 dedupKey 合并`,
      about,
    );
  }

  if (UPDATE_SUBJECT.test(subject)) {
    return withActionable("update", false, "high", "标题命中补充/更新材料：按 update 处理，不看正文里顺带提到的环节词");
  }

  const invited = subjectInvite(subject, body);
  if (invited) {
    return withActionable(invited[0], false, "high", `标题写明是 ${invited[0]} 的邀请 / 通知，正文也在说这件事`);
  }

  const hit = scanCategory(subject, body);
  if (hit) {
    const [type, pattern] = hit;
    const fromBody = pattern.test(body);
    return withActionable(
      type,
      false,
      "high",
      `${fromBody ? "正文" : "标题"}命中 ${type} 信号词`,
    );
  }

  // 没有任何正面信号命中：宁可不认，不能瞎猜。求职培训营销、广撒网的岗位
  // 推荐邮件都落在这里——它们的关键词（offer、大厂、招聘）跟真实流程进展
  // 高度重叠，没有为它们单独建一套「噪音黑名单」，而是让「不够具体」
  // 本身成为默认的安全出口，跟 dueType.ts 对未知时间的处理是同一个立场。
  return withActionable("other", false, "low", "没有命中任何已知事件类型信号");
}
