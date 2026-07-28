# 配備手順

**上から順に実行する。** 各手順に「確認」があり、そこが通らなければ次へ進まない。

前提: `gcloud` / `bq` / `firebase` にログイン済みで、`vcafe-admin-analytics` を操作できること。
本番プロジェクト `v-athome-cafe-app` へ書き込む手順は一つも含まれない（読み取りのみ）。

## 依存関係

```
手順1 (BigQuery の列追加)
   ├─→ 手順2 (ダッシュボード)    … 無くても動くが「最終同期 不明」と表示される
   └─→ 手順3〜5 (同期ジョブ)     ← 必須。飛ばすと全テーブルで挿入が失敗する
              └─→ 手順6 (スケジューラ再開)
                        └─→ 手順7 (recordKey ビュー切替。後日でよい)
```

> **手順1を飛ばして手順5を実行すると、全テーブルが `PartialFailureError` で失敗する。**
> 新しい同期コードは `recordKey` / `runId` 列を含む行を送るが、`ignoreUnknownValues: false`
> のため、BigQuery 側にその列が無いと1行も入らない。2026-07-27 に実際に起きた。

---

## 手順0: いまどこまで済んでいるか確認する

途中から再開する場合、まずここで現在地を判定する。

```bash
cd ~/vcafe-app/vcafe-dashboard

# (a) BigQuery に新しい列があるか → 無ければ手順1へ
bash services/analytics-sync/check-bigquery-schema.sh

# (b) ダッシュボードのリビジョン → 古ければ手順2へ
gcloud run services describe vcafe-dashboard --region=asia-northeast1 \
  --project=vcafe-admin-analytics --format='value(status.latestReadyRevisionName,status.url)'

# (c) 同期ジョブの環境変数 → PAGE_SIZE / RESCAN_DAYS が無ければ手順4へ
gcloud run jobs describe vcafe-analytics-sync --region=asia-northeast1 \
  --project=vcafe-admin-analytics \
  --format='value(spec.template.template.containers[0].env)'
```

(a) が `manifest と BigQuery のスキーマは一致しています。` なら手順1は完了している。

---

## 手順1: BigQuery に列とテーブルを追加する

**手順3〜5の前提。ここを飛ばすと同期ジョブが必ず失敗する。**

```bash
cd ~/vcafe-app/vcafe-dashboard
bash services/analytics-sync/apply-schema.sh
```

追加されるもの:

- 既存テーブルへ `recordKey` / `runId` 列（`ADD COLUMN IF NOT EXISTS`）
- `sync_runs` / `sync_rejects` / `dq_results` テーブル
- `sync_watermark` ビュー

既存データは変更されない。`_current` ビューは **id ベースのまま**なので、
この時点でダッシュボードの数字は変わらない。

**確認**:

```bash
bash services/analytics-sync/check-bigquery-schema.sh
# → 「manifest と BigQuery のスキーマは一致しています。」
```

> **注意**: 手順7を実施したあとに `apply-schema.sh` を再実行すると、
> `_current` ビューが id ベースへ戻る（＝手順7のロールバックになる）。
> 手順7の完了後は、列を追加する用があるときだけ実行する。

---

## 手順2: Webダッシュボードを配備する

```bash
cd ~/vcafe-app && git pull origin claude/nextjs-firebase-dashboard-review-w74yfo
cd vcafe-dashboard && bash deploy-tokyo.sh
```

含まれる修正:

- **認証の fail-closed 化**（`AUTH_MODE` 欠落時に管理者として通さない）
- **メイドへの顧客情報漏洩の遮断**（17列）
- **メイド明細のプレゼント結合**（常時0件だったのを修正）
- 指標の統一（ご帰宅数を全経路で重み付きに）
- 最終同期の表示を実際の同期時刻に

**配備前の確認**: `cloudrun.env.yaml` に `AUTH_MODE: firebase` があること（確認済み）。
無いと起動時に例外で停止する。それが fail-closed の設計。

**確認**: 管理者でログインし、6画面が表示されること。
メイドアカウントがあれば、ユーザー名が「非表示」になっていること。

**戻し方**: Cloud Run コンソールから直前のリビジョンへトラフィックを戻す。
手順1とは独立しているため、手順1を戻す必要はない。

---

## 手順3: 同期ジョブのイメージを更新する

```bash
bash services/analytics-sync/deploy-disabled-job-tokyo.sh
```

**このスクリプトは環境変数を `disabled.env.yaml` の内容で上書きする**
（`CONFIRM_READ_ONLY_SYNC=DISABLED` / `DRY_RUN=true` / `MAX_DOCUMENTS=100`）。
つまり、この直後にジョブを実行しても起動時に停止する。必ず手順4を続けて実行する。

---

## 手順4: 同期ジョブの環境変数を設定する

```bash
JOB=vcafe-analytics-sync; R=asia-northeast1; P=vcafe-admin-analytics

gcloud run jobs update $JOB --region=$R --project=$P \
  --update-env-vars="CONFIRM_READ_ONLY_SYNC=I_UNDERSTAND_THIS_READS_PRODUCTION,DRY_RUN=false,PAGE_SIZE=2000,MAX_DOCUMENTS=50000,SYNC_LOOKBACK_MINUTES=90,RESCAN_DAYS=3" \
  --set-secrets=CUSTOMER_ID_HMAC_SECRET=vcafe-customer-id-hmac:latest
```

**旧設定から変わった点**:

| 変数 | 変更 | 注意 |
| --- | --- | --- |
| `MAX_DOCUMENTS` | 「ページサイズ」→「**1ソース・1窓の総上限**」 | 旧値 `5000` のままだと超過時にジョブが失敗する。`50000` にする |
| `PAGE_SIZE` | 新設（1クエリの件数） | 未設定なら既定 `2000` |
| `RESCAN_DAYS` | 新設（直近N日を読み直す） | 読み取り量が増える。3日から始める |

---

## 手順5: 同期ジョブを1回だけ手動実行する

```bash
gcloud run jobs execute vcafe-analytics-sync --region=asia-northeast1 \
  --project=vcafe-admin-analytics --wait
```

**確認**: 実行ログの最終行が `status: "ok"` であること。

```json
{"run":{"status":"ok","windows":4,"failedWindows":0,"degradedSources":[]}}
{"reject":{"source":"userRecordVisits","reasonCode":"UNRESOLVED_MAID_OR_INVALID","rejected":0,"read":312}}
```

`status` が `ok` 以外、または `rejected` が読み取り件数の数%を超えるなら、
**手順6へ進まずに**下の「失敗したときの読み方」を見る。

**戻し方**: `gcloud run jobs update $JOB --image <直前のイメージ>`。
BigQuery のデータは追記のみなので、戻しても不整合は起きない。

### 失敗したときの読み方

| ログ | 原因 | 対処 |
| --- | --- | --- |
| `SCHEMA_PRECHECK_FAILED ... 不足列: recordKey` | **手順1が未実施** | 手順1を実行してから再実行 |
| `INSERT_FAILED ... PartialFailureError` が全テーブルで出る | 同上（旧イメージの場合） | 同上 |
| `取得件数が上限(MAX_DOCUMENTS=...)に達しました` | 手順4の `MAX_DOCUMENTS` が小さい | 値を上げるか期間を分割 |
| `degraded ... SOURCE_UNAVAILABLE` | 本番の collection group インデックス不足 | 欠けているソース名を確認。**本番のインデックスは変更しない** |
| `棄却率が ...% を超えました` | 本番のデータ形状が変わった可能性 | `sync_rejects` の `reasonCode` を確認 |

`1窓でも失敗すると非0終了する`のは意図した変更。従来は欠損しても成功扱いで気づけなかった。

---

## 手順6: スケジューラを再開する

**手順5が `ok` で終わってから。**

```bash
gcloud scheduler jobs resume vcafe-analytics-sync-schedule \
  --project=vcafe-admin-analytics --location=asia-northeast1
```

あわせて、データ品質監査を回せるようになる（手順1の完了後ならいつでも可）。

```bash
bash services/analytics-sync/analytics-audit.sh
```

---

## 手順7: recordKey のビュー切替（後日でよい）

**手順5・6が数日安定してから。全期間の再バックフィルが前提。**

```bash
# ① 全期間の再バックフィル（4区間。docs/enable-sync-runbook.md 手順8）
# ② 検証（recordKey が NULL の行が無いこと）
bash services/analytics-sync/verify-migration.sh
# ③ 切替（recordKey が NULL の行が1件でもあれば自動で中止される）
bash services/analytics-sync/apply-migration.sh 001-record-key-dedup.sql
# ④ 再検証
bash services/analytics-sync/verify-migration.sh
```

判定基準の詳細は `docs/migration-recordkey.md`。

**戻し方**: `bash services/analytics-sync/apply-schema.sh` で id ベースのビューに戻る。
データは触らない。

---

## よくある誤解

- **「全部揃ってから配備する」は不要。** 手順2の認証修正は現在進行形の脆弱性への対応で、
  SQL移行の完了を待つ性質のものではない。手順1→2まで済ませて一度止めてよい。
- **手順1は手順7ではない。** 手順1は列を足すだけ。ビューの切替（手順7）とは別物で、
  手順1だけを適用しても数字は変わらない。
- **手順3だけでは動かない。** `deploy-disabled-job-tokyo.sh` は環境変数を無効値で
  上書きするため、手順4とセットで実行する。
