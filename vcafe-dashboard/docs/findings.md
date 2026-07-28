# レビュー指摘の再検証結果

対象コミット `edec8d3` / ブランチ `claude/nextjs-firebase-dashboard-review-w74yfo`。
コードを読んで再現可否を確定させた。推測は「未検証」と明記する。

ベースライン（修正前）:

| 検査 | 結果 |
| --- | --- |
| `npm test` | 48 pass / 0 fail |
| `npm test --prefix services/analytics-sync` | 26 pass / 0 fail |
| `npx tsc --noEmit`（app） | exit 0 |
| `npm run build` | 成功 |

ただし **`tsconfig.json:exclude` が `tests` と `services` を除外**しているため、
上記の型検査は同期サービスとテストを一切見ていない（指摘11の一部）。

---

## confirmed（再現を確認）

### 1. 認証が fail-open — **重大**

`lib/auth.ts:7-10`

```ts
if (process.env.AUTH_MODE !== "firebase") {
  const role = process.env.DEMO_ROLE === "maid" ? "maid" : "admin";
  return { uid: "demo-user", ..., role, ... };
}
```

`AUTH_MODE` が未設定・誤記・空文字のいずれでも**デモ管理者**が返る。
Cloud Run は `--allow-unauthenticated`（`deploy-tokyo.sh:46`）なので、
環境変数の欠落だけで全 API が無認証で全データを返す。

副次:
- `lib/auth.ts:18` は `maidId` を `typeof === "string"` でしか見ておらず、空文字 `""` を通す。
  空文字は `enforceMaidScope`（`lib/analytics.ts:21`）の `!viewer.maidId` で例外になるため
  データ漏洩には至らないが、500 を返す経路になる。
- `app/api/auth/session/route.ts:15` も同様に空文字 `maidId` でセッションを発行する。
  一方 `lib/auth-claims.ts:12` は `!request.maidId?.trim()` で正しく弾いており、**実装が不一致**。

### 2. maid レスポンスに顧客の準識別子・財務情報が残る — **重大**

`lib/analytics.ts:37-44`

```ts
customers: data.customers.filter(...).map((customer) => ({
  ...customer,                                   // ← 全列を展開
  id: aliases.get(customer.id)!,
  name: "非表示",
  registeredAt: customer.registeredAt?.slice(0, 7) ?? null,
})),
```

上書きは `id` / `name` / `registeredAt` の3列のみ。`lib/types.ts` の `Customer` が持つ
`gender` `birthYear` `rank` `active` `lastVisitAt` `lastPaymentAt` `lastPurchasedItemAt`
`lastPresentAt` `purchasedItemCoin` `purchasedItemRewardPoint` `purchasedItemQuantity`
`presentAmount` `coin` `rewardPoint` `totalVisitAmount` `consecutiveVisitDays`
`maxConsecutiveVisitDays` は**そのまま maid のブラウザへ渡る**。

`segment-001` への置換は表示名だけの匿名化であり、
性別・生年・ランク・残高・課金額の組み合わせから個人が再識別され得る。

### 3. maid 明細でプレゼントが常に0件になる

`app/api/visit-logs/route.ts:20-21`

```ts
const data = scopeDataForViewer(await loadAnalyticsData(...), viewer);  // customerId → segment-00N
const logs = await loadMaidVisitLogs(data, { maidId, customerId, start, end });
```

`loadMaidVisitLogs` → `loadPresents`（`lib/maid-visits.ts:101-135`）は BigQuery から
**HMAC の customerId** を取得する。結合キーは
`` `${customerId}|${maidId}|${businessDateJst(at)}` ``（`lib/maid-visits.ts:56,67`）なので、
maid 経路では `segment-001` 対 HMAC となり**絶対に一致しない**。
admin 経路は仮名化しないため正常。

機能欠落であり、かつ「アイテム使用なし」と誤読させる。

### 4. 同期の無言打ち切りと部分成功

`services/analytics-sync/src/index.ts`

- `:24` `:40` — `readGroup` / `readCollection` とも `.limit(config.maxDocuments)` のみでページングなし。
  上限に到達したかを検知しておらず、**超過分は無言で欠落**する。
- `:253` — `if (failedWindows === windows.length) process.exit(1)`。
  **1窓でも成功すれば終了コード0**。Cloud Run Job は成功扱いになり、Scheduler も気づかない。
- `:89` `:94` — `PRESENTS_SKIPPED` / `USERPAYMENTS_SKIPPED` を `console.warn` のみで握りつぶし、
  空配列を返す。インデックス障害時に「プレゼント0件」が正常値として BigQuery に入る。
- `:136` `:139` `:157` — 5000 / 50000 / 1000 のマジックナンバー。前2つはページングなし。

### 5. メイドID解決が同期窓に依存する

`services/analytics-sync/src/index.ts:107`（`buildMaidMap(shiftDocuments)`）
+ `src/transform.ts:158-166`

`buildMaidMap` はその窓で取得した `workshifts` だけからニックネーム→ID表を作る。
`mapVisit`（`transform.ts:40-44`）は `maidId` が空のとき、この表で引けなければ
`` `nickname:${nickname}` `` を返す。

増分同期は既定90分窓（`SYNC_LOOKBACK_MINUTES`）なので、19時開始のシフトは
翌1時の訪問を処理する窓には含まれない。結果、同一メイドが正規IDと `nickname:*` に**分裂**する。

`schema.sql:194-207` の `maids_current` は `nickname:*` を「名簿に無いメイド」として
そのまま一覧に混ぜており、コメント（「名簿を正とし補完する」）と実際の動作が乖離している。

### 6. `payments_current` の全件フォールバック

`services/analytics-sync/schema.sql:47-70`

```sql
SELECT * FROM ledger
UNION ALL
SELECT * FROM latest
WHERE (source IS NULL OR source != 'userPayments')
  AND (SELECT COUNT(*) FROM ledger) = 0;
```

`userPayments` が **1件でも入った瞬間**、旧 `payments` / `purchaseLog` が全期間で除外される。
部分バックフィル中・インデックス障害・特定期間の欠損でも旧データが消える。
これは私が導入した設計であり、指摘のとおり危険。

また `status` による絞り込みが無く、失敗した決済も売上に混入する
（`transform.ts:154` は `purchaseFailedReason` を status に入れるだけ）。

### 7. `*_current` の一意キーが collection group で衝突し得る

`services/analytics-sync/src/index.ts:71`（`rowInsertId`）と
`schema.sql` の各ビュー `PARTITION BY id`。

`userRecordVisits` / `userPayments` などは **collection group** で読むため、
`document.id` は親（ユーザー）が違えば重複し得る。Firestore の自動ID衝突は稀だが、
`userPayments` は `mapUserPayment`（`transform.ts`）で
`` `${document.id}:${customerId.slice(0,8)}` `` と衝突回避しているのに対し、
`visits` / `presents` / `cheki` は **`document.id` 素のまま**で不整合。

`customers_raw` は `sourceUpdatedAt: null` を明示的に入れており（`index.ts:126`）、
`readUsers` が取得済みの `updateTime` を捨てている。

### 9. 重み付きご帰宅数が経路で不一致

- 概要 `lib/analytics.ts:78` → `weightedVisitCount`（weight 合計）
- メイド別 `lib/analytics.ts:127` → `weightedVisitCount`
- **ユーザー別 `lib/analytics.ts:160` → `visits.length`**
- **クロス表 `components/dashboard.tsx:645` → `+ 1`**

同じ「ご帰宅数」という名前で、滞在40分を 2 と数える経路と 1 と数える経路が混在している。

### 10. Python と TypeScript で丸めが異なる

- `core.py:227` → `weight = max(1, round(init_time / 20))` … Python の `round` は**偶数丸め**
- `lib/metrics.ts:40` → `Math.max(1, Math.round(safe / 20))` … JS は**0.5 切り上げ**

`initialTime = 50` のとき `50/20 = 2.5` → **Python 2 / TypeScript 3**。
`initialTime = 30`（1.5）でも Python 2 / TypeScript 2 と一致するが、
2.5 / 4.5 / 6.5 のような偶数境界で系統的にずれる。

### 11. 型検査が services/ と tests/ を見ていない

`tsconfig.json:exclude` に `["node_modules", "tests", "services"]`。
`services/analytics-sync` に固有の `tsconfig.json` は存在しない。

明示的に型検査すると**既存のエラーが検出される**:

```
services/analytics-sync/src/index.ts(124,29): error TS2345:
  Argument of type 'ChekiRow[]' is not assignable to parameter of type 'Record<string, unknown>[]'.
```

`npm test` は `tsx` で実行するため型エラーがあっても通り、CI でも検出されない。

---

## partially confirmed

### 8. 履歴修正を取り込めない

増分同期が `enterDateTime` / `openTime` / `paymentDate` など**イベント時刻**で範囲選択している
（`index.ts:83-98`）のは事実で、過去イベントの後日修正は次回同期の窓に入らない。

ただし `*_current` ビューは `sourceUpdatedAt DESC, syncedAt DESC` で最新行を選ぶため、
**バックフィルを再実行すれば修正は反映される**。「取り込めない」ではなく
「増分同期では取り込めず、明示的な再走査が必要」が正確。削除の検知は不可能という点は事実。

---

## 補足（指摘に無いが確認した事実）

- `enforceMaidScope`（`analytics.ts:19-25`）自体は正しく動作しており、
  maid が `?maidId=` で他人を指定しても自分のIDに強制される。指摘1の副次的被害は限定的。
- `app/api/customers/route.ts:31` は `viewer.role !== "admin"` で 403 を返しており、
  ユーザーDB API に maid は到達できない。指摘2の漏洩経路は `/api/analytics` と
  `/api/visit-logs` に限られる。
- CSV出力（`dashboard.tsx`）はクライアント側で `data.customers` を使うため、
  指摘2が直れば CSV からも自動的に消える。
