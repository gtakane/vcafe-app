// 公式サイトのお知らせ一覧（https://virtual.cafe-athome.com/news）から、公開日・タイトル・URLを取り出す。
// 月次指標の「出来事」「URL」に使う。サイトの作りが変わって取り出せなくなったときは空を返し、画面に理由を出す。

import type { NewsItem } from "./monthly-kpi.ts";

export const NEWS_BASE_URL = "https://virtual.cafe-athome.com";

// 一覧の各記事に付いている区分の表示。タイトルの前後に付いていたら外す。
const LABELS = ["新着", "NEW", "New", "お知らせ", "イベント終了", "イベント開催中", "開催中", "イベント", "キャンペーン", "メイド", "終了"];

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&#x27;": "'", "&nbsp;": " " };

function textOf(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/[ \t\r\n　]+/g, " ")
    .trim();
}

const DATE_PATTERN = /(20\d{2})\s*[./年-]\s*(\d{1,2})\s*[./月-]\s*(\d{1,2})\s*日?(?:\s*[（(][^）)]{1,3}[）)])?/;

function stripLabels(text: string): string {
  let result = text.trim();
  for (let changed = true; changed;) {
    changed = false;
    for (const label of LABELS) {
      if (result.startsWith(label + " ") || result === label) { result = result.slice(label.length).trim(); changed = true; }
      if (result.endsWith(" " + label)) { result = result.slice(0, -label.length).trim(); changed = true; }
    }
  }
  return result;
}

/**
 * 一覧ページのHTMLから記事を取り出す。
 * 記事へのリンク（/news/{記事}）ごとに、リンクの中（無ければ直前）の日付と、日付・区分を除いた文字をタイトルとする。
 */
export function parseNewsHtml(html: string, base = NEWS_BASE_URL): NewsItem[] {
  const items = new Map<string, NewsItem>();
  const anchor = /<a\b[^>]*href="((?:https?:\/\/[^"/]+)?\/news\/[^"?#]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (let match = anchor.exec(html); match; match = anchor.exec(html)) {
    const [, href, inner] = match;
    const url = href.startsWith("http") ? href : `${base}${href}`;
    if (items.has(url)) continue;
    let text = textOf(inner);
    let date = text.match(DATE_PATTERN);
    if (!date) date = textOf(html.slice(Math.max(0, match.index - 400), match.index)).match(new RegExp(`${DATE_PATTERN.source}(?![\\s\\S]*${DATE_PATTERN.source})`));
    if (!date) continue;
    text = text.replace(DATE_PATTERN, " ");
    const title = stripLabels(text.replace(/\s+/g, " "));
    if (!title) continue;
    const iso = `${date[1]}-${date[2].padStart(2, "0")}-${date[3].padStart(2, "0")}`;
    items.set(url, { date: iso, title, url });
  }
  return [...items.values()].sort((a, b) => a.date.localeCompare(b.date) || a.url.localeCompare(b.url));
}

const CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map<number, { at: number; items: NewsItem[] }>();

/** 年ごとの一覧を取得する（6時間使い回す）。取得・解析できない年は errors に理由を入れる。 */
export async function loadOfficialNews(years: number[]): Promise<{ items: NewsItem[]; errors: string[] }> {
  const items: NewsItem[] = [];
  const errors: string[] = [];
  const currentYear = new Date(Date.now() + 9 * 3600000).getUTCFullYear();
  for (const year of [...new Set(years)].sort()) {
    const cached = cache.get(year);
    if (cached && Date.now() - cached.at < CACHE_MS) { items.push(...cached.items); continue; }
    const url = year === currentYear ? `${NEWS_BASE_URL}/news` : `${NEWS_BASE_URL}/news?year=${year}`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "vcafe-dashboard (monthly-kpi)" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = parseNewsHtml(await response.text()).filter((item) => item.date.startsWith(String(year)));
      if (!parsed.length) throw new Error("記事を読み取れませんでした（サイトの作りが変わった可能性があります）");
      cache.set(year, { at: Date.now(), items: parsed });
      items.push(...parsed);
    } catch (error) {
      errors.push(`${year}年のお知らせを取得できませんでした: ${(error as Error).message}`);
    }
  }
  return { items, errors };
}
