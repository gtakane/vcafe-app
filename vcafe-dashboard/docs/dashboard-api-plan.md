# ダッシュボードAPIの段階的移行計画

`dashboard.tsx` の分割（731行 → 225行 + 11ファイル）は完了した。
ただし**ファイル分割だけでは根本問題は解決していない**。ここではその先の設計を示す。

## いまの問題

`lib/data-source.ts` の `loadAnalyticsData()` は、期間内の
**全 visit / 全 shift / 全 customer** を `TO_JSON_STRING` で1クエリにまとめ、
そのままブラウザへ返している。集計もクライアント側（`summarize` / `maidRows` /
`customerRows` / `crossVisitCounts`）で行っている。

現在のデータ量（1か月あたり visits 約3,000件）では動くが、次の順で壊れる。

| データ量 | 最初に壊れる場所 |
| --- | --- |
| 3〜5倍 | 初期表示のペイロード肥大（`app/page.tsx` の SSR がそのまま HTML に載る） |
| 5〜10倍 | `crossVisitCounts` と `customerRows` の O(顧客数 × 訪問数) 走査 |
| 10倍〜 | BigQuery の `maximumBytesBilled`（現在 1GiB）に到達してクエリ自体が失敗 |

期間を「今年」に広げた時点で今でも到達し得る。

## 移行方針

**一度に置き換えない。** 画面ごとに「サーバー集計＋ページング」のAPIを追加し、
既存の全件取得を並行して残したまま切り替える。切り替え後に旧経路を削除する。

### 段階1: 集計をサーバーへ寄せる（表示を変えない）

| 追加API | 返すもの | 置き換える対象 |
| --- | --- | --- |
| `GET /api/summary` | KPI 4件＋推移（バケット済み） | `summarize` / `buildTrend` |
| `GET /api/maids` | メイド別集計（既にサーバー集計可能） | `maidRows` |
| `GET /api/relations` | メイド×ユーザーの重み付き件数（上位N件） | `crossVisitCounts` |

いずれも BigQuery 側で `GROUP BY` する。返す行数が定数になるため、
データ量が増えてもペイロードは増えない。

**このとき指標の定義を変えないこと。** `lib/metrics.ts` と
`tests/fixtures/rounding-golden.json` の契約に SQL 側も従わせ、
同一 fixture で TypeScript・Python・SQL の3者が一致することをテストする。

### 段階2: 一覧をページングする

`GET /api/customers` は既にサーバー側で絞り込み・並べ替え・`LIMIT` を行っている
（`lib/customers.ts`）。これを他の一覧にも広げる。

- `GET /api/visit-logs` … `limit` / `cursor`（`at` + `recordKey` の複合カーソル）を追加
- `GET /api/attendance` … 同上。現在は全シフトをクライアントで絞っている

カーソルは `services/analytics-sync/src/paging.ts` と同じ考え方
（時刻＋一意キー）で、同一時刻が並んでも前進できるようにする。

### 段階3: 全件取得の廃止

`app/page.tsx` の `loadAnalyticsData()` を段階1・2のAPIに置き換え、
`AnalyticsData` 全件を SSR に載せるのをやめる。
`lib/data-source.ts` は CSV 出力など「本当に全件が要る」用途だけに残す
（その場合もサーバー側でストリーミング生成し、ブラウザには載せない）。

## 分割後のファイル構成

```
components/dashboard.tsx                  225行  画面の骨格・ナビ・期間フィルタ
components/dashboard/shared/format.ts            表示フォーマット（通貨・日時・切り捨て）
components/dashboard/shared/metric-card.tsx      KPIカード
components/dashboard/shared/line-chart.tsx       推移グラフ
components/dashboard/views/maid-performance-view.tsx
components/dashboard/views/customer-database-view.tsx
components/dashboard/views/relations-view.tsx
components/dashboard/views/growth-view.tsx
components/dashboard/views/attendance-view.tsx
components/dashboard/visit-log/table.tsx
components/dashboard/visit-log/panel.tsx
lib/csv.ts                                       CSV生成（インジェクション対策込み）
```

## 未実施

- `components/dashboard/hooks/use-analytics-data.ts` … データ取得の `useEffect` を
  フックへ切り出す作業。着手したが、UI状態（タブ選択など）が同じ `useEffect` 群に
  混在しており、機械的に切り出すと壊れることを確認したため差し戻した。
  段階1でAPIを分けるときに、画面ごとのフックとして自然に分かれるため、
  そのタイミングで行うのが安全。
- `components/dashboard/views/overview-view.tsx` … 概要画面は骨格と密結合しており、
  切り出すと props の受け渡しだけが増える。段階1で `/api/summary` を入れた後に分離する。
