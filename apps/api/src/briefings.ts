import type { BriefingItem, DashboardBriefing } from "@bossassistant/contracts";

const CACHE_TTL_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

let cachedBriefing: DashboardBriefing | null = null;
let cachedAt = 0;
let inflight: Promise<DashboardBriefing> | null = null;

function decodeHtml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(value: string) {
  return decodeHtml(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeComparable(value: string) {
  return stripTags(value).toLowerCase().replace(/[\s"'`“”‘’.,:：;；!！?？()[\]{}<>/\\|&-]+/g, "");
}

function escapeForRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanSummary(title: string, description: string, fallback: string) {
  const cleanTitle = stripTags(title);
  const canonicalTitle = cleanTitle
    .replace(/\s*[-|｜]\s*[a-z0-9.-]+\.[a-z]{2,}\s*$/i, "")
    .replace(/\s*[-|｜]\s*x\.com\s*$/i, "")
    .trim();
  const cleanDescription = stripTags(description);

  if (!cleanDescription) {
    return fallback;
  }

  let summary = cleanDescription
    .replace(new RegExp(`^${escapeForRegExp(canonicalTitle)}\\s*`, "i"), "")
    .replace(new RegExp(`^${escapeForRegExp(cleanTitle)}\\s*`, "i"), "")
    .replace(/^\s*[-|｜:：]\s*/, "")
    .replace(/\s*&nbsp;\s*/gi, " ")
    .replace(/\s*x\.com\s*$/i, "")
    .replace(/\s*-\s*x\.com\s*$/i, "")
    .replace(/\s*[a-z0-9.-]+\.[a-z]{2,}\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (
    !summary ||
    normalizeComparable(summary) === normalizeComparable(cleanTitle) ||
    normalizeComparable(summary) === normalizeComparable(canonicalTitle)
  ) {
    return fallback;
  }

  return summary;
}

function snippet(value: string, maxLength = 180) {
  const clean = stripTags(value);

  if (clean.length <= maxLength) {
    return clean;
  }

  return `${clean.slice(0, maxLength).trim()}...`;
}

function firstTagValue(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.trim() ?? "";
}

function parseRss(xml: string) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => {
    const block = match[1];
    return {
      title: stripTags(firstTagValue(block, "title")),
      link: decodeHtml(firstTagValue(block, "link")),
      description: firstTagValue(block, "description"),
      publishedAt: firstTagValue(block, "pubDate")
    };
  });
}

function uniqueById(items: BriefingItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${normalizeComparable(item.title)}::${item.url}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function sortByPublishedAtDesc<T extends { publishedAt: string }>(items: T[]) {
  return items.slice().sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime());
}

function takeFromSources(groups: BriefingItem[][], limit: number) {
  const output: BriefingItem[] = [];
  let index = 0;

  while (output.length < limit) {
    let advanced = false;

    for (const group of groups) {
      if (group[index]) {
        output.push(group[index]);
        advanced = true;

        if (output.length >= limit) {
          return uniqueById(output).slice(0, limit);
        }
      }
    }

    if (!advanced) {
      break;
    }

    index += 1;
  }

  return uniqueById(output).slice(0, limit);
}

async function fetchJson<T>(url: string) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "BossAssistant/0.1"
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      accept: "text/plain, application/xml, text/xml, application/rss+xml, text/html",
      "user-agent": "BossAssistant/0.1"
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }

  return response.text();
}

function toIsoDate(value: string | number) {
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function makeId(prefix: string, value: string) {
  return `${prefix}_${value.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 42)}`;
}

async function fetchGoogleNewsItems(args: {
  query: string;
  source: string;
  badge: string;
  limit: number;
  fallbackSummary: string;
  locale?: "zh-Hant" | "en";
  region?: "HK" | "US";
}) {
  const locale = args.locale ?? "zh-Hant";
  const region = args.region ?? "HK";
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(args.query)}&hl=${locale === "zh-Hant" ? "zh-CN" : "en-US"}&gl=${region}&ceid=${region}:${locale}`;
  const xml = await fetchText(url);

  return parseRss(xml)
    .slice(0, args.limit)
    .map((item) => ({
      id: makeId(args.source.toLowerCase().replace(/[^a-z0-9]+/g, "_"), item.title),
      title: item.title,
      summary: snippet(cleanSummary(item.title, item.description, args.fallbackSummary)),
      source: args.source,
      url: item.link,
      publishedAt: toIsoDate(item.publishedAt),
      badge: args.badge
    }));
}

async function fetchXWatchHotspots() {
  return fetchGoogleNewsItems({
    query: "site:x.com (AI OR OpenAI OR Anthropic OR Gemini OR NVIDIA) when:7d",
    source: "X Watch",
    badge: "X / AI",
    limit: 6,
    fallbackSummary: "来自 X/Twitter 相关讨论的 AI 热点。"
  }).then((items) => items.filter((item) => !/^功能列表\s*-\s*x\.com$/i.test(item.title)));
}

async function fetchSocialHotspots(): Promise<BriefingItem[]> {
  const [xWatch, redditBuzz, hackerNewsBuzz] = await Promise.all([
    fetchXWatchHotspots().catch(() => []),
    fetchRedditSocialHotspots().catch(() => []),
    fetchHackerNewsSocialHotspots().catch(() => [])
  ]);

  return takeFromSources(
    [
      sortByPublishedAtDesc(xWatch),
      sortByPublishedAtDesc(redditBuzz),
      sortByPublishedAtDesc(hackerNewsBuzz)
    ],
    8
  );
}

async function fetchRedditSocialHotspots(): Promise<BriefingItem[]> {
  type RedditResponse = {
    data: {
      children: Array<{
        data: {
          title: string;
          selftext: string;
          permalink: string;
          created_utc: number;
          ups: number;
          subreddit_name_prefixed: string;
        };
      }>;
    };
  };

  const payload = await fetchJson<RedditResponse>("https://www.reddit.com/r/artificial/hot.json?limit=5");

  return payload.data.children.map(({ data }) => ({
    id: makeId("reddit", data.title),
    title: data.title,
    summary: snippet(cleanSummary(data.title, data.selftext, "近期 AI 社区热议话题，适合快速进入上下文。")),
    source: `${data.subreddit_name_prefixed} / Reddit`,
    url: `https://www.reddit.com${data.permalink}`,
    publishedAt: toIsoDate(data.created_utc * 1000),
    badge: `▲ ${data.ups}`
  }));
}

async function fetchHackerNewsSocialHotspots(): Promise<BriefingItem[]> {
  const xml = await fetchText("https://hnrss.org/newest?q=AI");

  return parseRss(xml)
    .slice(0, 3)
    .map((item) => ({
      id: makeId("hn", item.title),
      title: item.title,
      summary: snippet(cleanSummary(item.title, item.description, "Hacker News 上最近讨论的 AI 话题。")),
      source: "Hacker News",
      url: item.link,
      publishedAt: toIsoDate(item.publishedAt),
      badge: "HN"
    }));
}

async function fetchNewsHotspots(): Promise<BriefingItem[]> {
  const [hkAi, hkTech] = await Promise.all([
    fetchGoogleNewsItems({
      query: "(AI OR 人工智能 OR 大模型 OR OpenAI) when:7d",
      source: "Google News HK",
      badge: "香港 AI",
      limit: 5,
      fallbackSummary: "香港视角的 AI 新闻热点。"
    }).catch(() => []),
    fetchGoogleNewsItems({
      query: "(香港 AI OR 香港 人工智能 OR 香港 科技 OR 香港 创科) when:7d",
      source: "Hong Kong Tech",
      badge: "香港创科",
      limit: 4,
      fallbackSummary: "与香港 AI / 创科相关的近期新闻。"
    }).catch(() => [])
  ]);

  return takeFromSources([sortByPublishedAtDesc(hkAi), sortByPublishedAtDesc(hkTech)], 6);
}

async function fetchGithubHot(): Promise<BriefingItem[]> {
  const createdAfter = new Date();
  createdAfter.setDate(createdAfter.getDate() - 30);
  const dateFilter = createdAfter.toISOString().slice(0, 10);
  const url = `https://api.github.com/search/repositories?q=AI+created:%3E${dateFilter}&sort=stars&order=desc&per_page=5`;
  const payload = await fetchJson<{
    items: Array<{
      full_name: string;
      html_url: string;
      description: string | null;
      stargazers_count: number;
      updated_at: string;
    }>;
  }>(url);

  return payload.items.map((repo) => ({
    id: makeId("github", repo.full_name),
    title: repo.full_name,
    summary: snippet(cleanSummary(repo.full_name, repo.description ?? "", "近期 GitHub 上升势头很快的 AI 项目。")),
    source: "GitHub",
    url: repo.html_url,
    publishedAt: toIsoDate(repo.updated_at),
    badge: `★ ${repo.stargazers_count.toLocaleString("en-US")}`
  }));
}

async function fetchResearchHot(): Promise<BriefingItem[]> {
  const xml = await fetchText("https://export.arxiv.org/rss/cs.AI");

  return parseRss(xml)
    .slice(0, 5)
    .map((item) => ({
      id: makeId("research", item.title),
      title: item.title,
      summary: snippet(cleanSummary(item.title, item.description, "来自 arXiv cs.AI 的最新论文。")),
      source: "arXiv cs.AI",
      url: item.link,
      publishedAt: toIsoDate(item.publishedAt),
      badge: "Paper"
    }));
}

async function fetchFundingHot(): Promise<BriefingItem[]> {
  const xml = await fetchText(
    'https://news.google.com/rss/search?q=%22AI%22+funding+OR+raised+OR+%22Series+A%22+OR+%22Series+B%22&hl=en-US&gl=US&ceid=US:en'
  );

  return parseRss(xml)
    .slice(0, 5)
    .map((item) => ({
      id: makeId("funding", item.title),
      title: item.title,
      summary: snippet(cleanSummary(item.title, item.description, "近期 AI 融资动态。")),
      source: "Funding Watch",
      url: item.link,
      publishedAt: toIsoDate(item.publishedAt),
      badge: "Funding"
    }));
}

function buildFallbackBriefing(): DashboardBriefing {
  const now = new Date().toISOString();
  const fallback = (id: string, title: string, summary: string, source: string, url: string, badge: string): BriefingItem => ({
    id,
    title,
    summary,
    source,
    url,
    publishedAt: now,
    badge
  });

  return {
    refreshedAt: now,
    hotspots: {
      social: [
        fallback(
          "social_fallback",
          "社区热点暂时不可用",
          "网络源暂时不可达，稍后刷新即可恢复热点播报。",
          "BossAssistant",
          "https://www.reddit.com/r/artificial/",
          "Retry"
        )
      ],
      news: [
        fallback(
          "news_fallback",
          "新闻热点暂时不可用",
          "当前先保留原位，避免面板为空。",
          "BossAssistant",
          "https://news.google.com/",
          "Retry"
        )
      ]
    },
    aiColumn: {
      github: [
        fallback(
          "github_fallback",
          "GitHub 热点暂时不可用",
          "稍后刷新后会重新抓取近期最热的 AI 项目。",
          "BossAssistant",
          "https://github.com/trending",
          "Retry"
        )
      ],
      research: [
        fallback(
          "research_fallback",
          "科研成果暂时不可用",
          "稍后刷新后会从 arXiv 补回最新论文。",
          "BossAssistant",
          "https://export.arxiv.org/rss/cs.AI",
          "Retry"
        )
      ],
      funding: [
        fallback(
          "funding_fallback",
          "AI 融资动态暂时不可用",
          "稍后刷新后会重新聚合融资新闻。",
          "BossAssistant",
          "https://news.google.com/search?q=AI%20funding",
          "Retry"
        )
      ]
    }
  };
}

async function buildDashboardBriefing(): Promise<DashboardBriefing> {
  const fallback = buildFallbackBriefing();
  const social = await fetchSocialHotspots().catch(() => fallback.hotspots.social);
  const news = await fetchNewsHotspots().catch(() => fallback.hotspots.news);
  const [github, research, funding] = await Promise.all([
    fetchGithubHot().catch(() => fallback.aiColumn.github),
    fetchResearchHot().catch(() => fallback.aiColumn.research),
    fetchFundingHot().catch(() => fallback.aiColumn.funding)
  ]);

  return {
    refreshedAt: new Date().toISOString(),
    hotspots: {
      social,
      news
    },
    aiColumn: {
      github,
      research,
      funding
    }
  };
}

export async function getDashboardBriefing(forceRefresh = false) {
  const now = Date.now();

  if (!forceRefresh && cachedBriefing && now - cachedAt < CACHE_TTL_MS) {
    return cachedBriefing;
  }

  if (inflight) {
    return inflight;
  }

  inflight = buildDashboardBriefing()
    .then((result) => {
      cachedBriefing = result;
      cachedAt = Date.now();
      return result;
    })
    .catch((error) => {
      if (cachedBriefing) {
        return cachedBriefing;
      }

      console.warn("Unable to refresh dashboard briefing.", error);
      return buildFallbackBriefing();
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}
