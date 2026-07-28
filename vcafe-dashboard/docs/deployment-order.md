# 配備順序

レビュー対応の変更は**性質が違うものが混在**しているため、まとめて配備しない。
段階ごとに独立して配備・検証・ロールバックできるよう分けてある。

| 段階 | 内容 | 緊急度 | ロールバック |
| --- | --- | --- | --- |
| A | BigQuery の列・テーブル追加 | 中（Bの前提） | 不要（追加のみ） |
| B | Webダッシュボード | **高**（認証の脆弱性） | 直前リビジョンへ切替 |
| C | 同期ジョブ | 中 | 直前イメージへ切替 |
| D | recordKey のビュー切替 | 低 | ビュー再作成のみ |

**A → B を先に済ませること。** C・D は落ち着いてからでよい。

---

## 段階A: BigQuery の列・テーブル追加

```bash
cd ~/vcafe-app/vcafe-dashboard
bash services/analytics-sync/apply-schema.sh
```

追加されるもの: `recordKey` / `runId` 列、`sync_runs` / `sync_rejects` / `dq_results` テーブル、
`sync_watermark` ビュー。既存データは変更されない（`ADD COLUMN IF NOT EXISTS` と
`CREATE TABLE IF NOT EXISTS` のみ）。

**ビューは id ベースのまま**なので、この時点でダッシュボードの数字は変わらない。

> Bを先にやると、`sync_watermark` が無いためダッシュボードに
> 「最終同期 不明・同期状況を取得できませんでした」と表示される。
> 表示が壊れるわけではないが、Aを先にするほうが自然。

## 段階B: Webダッシュボード（最優先）

```bash
cd ~/vcafe-app && git pull origin claude/nextjs-firebase-dashboard-review-w74yfo
cd vcafe-dashboard && bash deploy-tokyo.sh
```

含まれる修正:
- **認証の fail-closed 化**（`AUTH_MODE` 欠落で管理者にならない）
- **maid への顧客情報漏洩の遮断**（17列）
- **maid明細のプレゼント結合**（常時0件だったのを修正）
- 指標の統一（ご帰宅数を全経路で重み付きに）
- 最終同期の表示を実際の同期時刻に

**配備前の確認**: `cloudrun.env.yaml` に `AUTH_MODE: firebase` があること。
無いと起動時に例外で停止する（それが fail-closed の設計）。確認済み。

**確認方法**: 配備後に管理者でログインし、6画面が表示されること。
メイドアカウントがあれば、ユーザー名が「非表示」になっていることも確認する。

**ロールバック**: Cloud Run コンソールから直前のリビジョンへトラフィックを戻す。
段階Aの列追加とは独立しているため、Aを戻す必要はない。

## 段階C: 同期ジョブ

**挙動が変わるため、事前に環境変数を見直すこと。**

```bash
JOB=vcafe-analytics-sync; R=asia-northeast1; P=vcafe-admin-analytics

# ① イメージ再ビルド（env が disabled.env.yaml に置き換わる点に注意）
bash services/analytics-sync/deploy-disabled-job-tokyo.sh

# ② 環境変数を再適用。MAX_DOCUMENTS の意味が変わった点に注意
gcloud run jobs update $JOB --region=$R --project=$P \
  --update-env-vars="CONFIRM_READ_ONLY_SYNC=I_UNDERSTAND_THIS_READS_PRODUCTION,DRY_RUN=false,PAGE_SIZE=2000,MAX_DOCUMENTS=50000,SYNC_LOOKBACK_MINUTES=90,RESCAN_DAYS=3" \
  --set-secrets=CUSTOMER_ID_HMAC_SECRET=vcafe-customer-id-hmac:latest

# ③ まず1回だけ手動実行してログを確認する
gcloud run jobs execute $JOB --region=$R --project=$P --wait
```

### 変わった点と確認すること

| 変更 | 確認 |
| --- | --- |
| `MAX_DOCUMENTS` が「ページサイズ」→「**1ソース・1窓の総上限**」 | 旧設定 `5000` のままだと超過時にジョブが失敗する。`50000` へ |
| `PAGE_SIZE` が新設（1クエリの件数） | 未設定なら既定 `2000` |
| メイドを特定できない行を **reject** するようになった | ログの `reject` と `sync_rejects` の件数。想定外に多ければ名簿の欠落を疑う |
| 棄却率が20%超で窓を失敗させる | `REJECT_RATE_THRESHOLD` で調整可能 |
| 1窓でも失敗すると**非0終了**する | 従来は成功扱いだった。失敗が見えるようになっただけで、悪化ではない |
| `RESCAN_DAYS` で直近N日を読み直す | 読み取り量が増える。3日程度から始める |

**ログで見るもの**:

```
{"run":{"status":"ok","windows":4,"failedWindows":0,"degradedSources":[]}}
{"reject":{"source":"userRecordVisits","reasonCode":"UNRESOLVED_MAID_OR_INVALID","rejected":0,"read":312}}
```

`status` が `ok` 以外、または `rejected` が読み取り件数の数%を超えるなら、
段階Dへ進まずに原因を確認する。

**ロールバック**: `gcloud run jobs update $JOB --image <直前のイメージ>`。
BigQuery のデータは追記のみなので、戻しても不整合は起きない。

## 段階D: recordKey のビュー切替

**段階Cが安定してから。全期間の再バックフィルが前提。**

```bash
# ① 全期間の再バックフィル（4区間。docs/enable-sync-runbook.md 手順8）
# ② 検証
bash services/analytics-sync/verify-migration.sh
# ③ 切替（recordKey が NULL の行が1件でもあれば自動で中止される）
bash services/analytics-sync/apply-migration.sh 001-record-key-dedup.sql
# ④ 再検証
bash services/analytics-sync/verify-migration.sh
```

詳細と判定基準は `docs/migration-recordkey.md`。

**ロールバック**: `bash services/analytics-sync/apply-schema.sh` で
id ベースのビューに戻る。データは触らない。

---

## 配備後に有効化するもの

```bash
# 停止中のスケジューラを再開（段階Cの確認後）
gcloud scheduler jobs resume vcafe-analytics-sync-schedule \
  --project=vcafe-admin-analytics --location=asia-northeast1

# データ品質監査を日次で回す（段階A完了後ならいつでも）
bash services/analytics-sync/analytics-audit.sh
```

## よくある誤解

- **「全部揃ってから配備する」は不要。** 段階Bの認証修正は現在進行形の脆弱性への対応で、
  SQL移行の完了を待つ性質のものではない。
- **段階Aは段階Dではない。** Aは列を足すだけで、ビューの切替（D）とは別。
  Aだけ適用しても数字は変わらない。
- **段階Cの「失敗するようになった」は悪化ではない。** 従来は欠損しても成功扱いで
  気づけなかった。失敗が見えるのは意図した変更。
