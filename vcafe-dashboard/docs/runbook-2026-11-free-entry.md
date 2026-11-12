# 2026-11 無料ご帰宅3種対応と欠落日の再取り込み

対象: 2026-11-06（ver1.4.7/1.4.8）から始まった無料ご帰宅3種の判定、および
2026-10下旬の課金停止期間に取りこぼした日の埋め戻し。

**上から順に Cloud Shell で実行する。** 本番プロジェクト `v-athome-cafe-app` へ書き込む手順は無い（読み取りのみ）。

## 変更内容

| 項目 | 変更前 | 変更後 |
| --- | --- | --- |
| 無料ご帰宅券（`freeGokitaku`・10分） | 有料扱い・売上0円 | 無料枠（`type=free`, `entryType=freeTicket`） |
| 新規ユーザー無料（20分） | 有料扱い（あっとコイン払い・消費0） | 無料枠（`entryType=newUserFree`） |
| 新人メイド無料（20分） | 有料扱い（同上） | 無料枠（`entryType=freshMaidFree`） |
| お試し（`trial10minutes`） | 無料 | 変更なし（無料枠に合算して表示） |
| 有料ご帰宅数 | お試し以外すべて | 無料枠（お試し＋3種）以外 |
| 保存項目 | — | `entryType` / `billedCoinVendor`（apple・google） / `usedTicketCount` を追加 |

判定はご帰宅記録の `isFreeEntry=true` と `entryType`。20分の2種はチケットIDを持たないため、
チケットIDだけでは判定できない。

> 判定は同期時に行い BigQuery に保存されるため、**コード更新だけでは11/6以降の過去分は直らない。**
> 手順4の再取り込みが必要。

> Streamlit 版（`core.py`）は未対応。11/6以降の有料件数は Streamlit 版と一致しない。

---

## 手順0: コードを取得する

```bash
cd ~ && [ -d vcafe-app ] || git clone https://github.com/gtakane/vcafe-app
cd ~/vcafe-app && git fetch origin claude/nextjs-firebase-dashboard-review-w74yfo \
  && git checkout claude/nextjs-firebase-dashboard-review-w74yfo && git pull --ff-only
```

## 手順1: 欠落日の確認（読み取りのみ）

BigQuery で 10/20 が0件、10/25 が40件だった。休業日・短縮営業だったのか、取りこぼしなのかを
本番 Firestore の件数と突き合わせて判定する。

```bash
mkdir -p ~/vcafe-inspect && cd ~/vcafe-inspect && [ -d node_modules/firebase-admin ] || (npm init -y >/dev/null && npm i firebase-admin >/dev/null 2>&1)
cat > count-days.mjs <<'EOF'
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: "v-athome-cafe-app" }));
// 営業日 = JST から2時間引いた日付（ダッシュボードと同じ）
const start = new Date("2026-10-17T17:00:00Z"), end = new Date("2026-10-28T17:00:00Z");
const snap = await db.collectionGroup("userRecordVisits")
  .where("enterDateTime", ">=", Timestamp.fromDate(start)).where("enterDateTime", "<", Timestamp.fromDate(end)).get();
const days = new Map();
for (const d of snap.docs) {
  const t = d.get("enterDateTime").toDate().getTime() + 7 * 3600e3; // +9h -2h
  const key = new Date(t).toISOString().slice(0, 10);
  days.set(key, (days.get(key) || 0) + 1);
}
for (const k of [...days.keys()].sort()) console.log(k, days.get(k));
process.exit(0);
EOF
node count-days.mjs
```

BigQuery 側の同じ期間:

```bash
bq query --project_id=vcafe-admin-analytics --use_legacy_sql=false --format=pretty \
 'SELECT DATE(TIMESTAMP_SUB(`at`, INTERVAL 2 HOUR),"Asia/Tokyo") AS d, COUNT(*) AS n FROM vcafe_analytics.visits_current_range("2026-10-18","2026-10-28",NULL) GROUP BY d ORDER BY d'
```

Firestore の件数（テストユーザー分を含む）が BigQuery より明らかに多い日が、取りこぼし。

## 手順2: BigQuery に列を追加する

**`apply-schema.sh` は使わない。** recordKey ビュー切替（配備手順7）が済んでいる場合、
ビューが id ベースに戻ってしまうため。今回は列追加の1文だけを実行する。

```bash
bq query --project_id=vcafe-admin-analytics --use_legacy_sql=false \
 'ALTER TABLE `vcafe-admin-analytics.vcafe_analytics.visits_raw`
    ADD COLUMN IF NOT EXISTS entryType STRING,
    ADD COLUMN IF NOT EXISTS billedCoinVendor STRING,
    ADD COLUMN IF NOT EXISTS usedTicketCount INT64'
cd ~/vcafe-app/vcafe-dashboard && bash services/analytics-sync/check-bigquery-schema.sh
```

**確認**: 「manifest と BigQuery のスキーマは一致しています。」

既存行の新列は NULL になるだけで、ダッシュボードの数字はこの時点では変わらない。

## 手順3: 同期ジョブのイメージだけを差し替える

**`deploy-disabled-job-tokyo.sh` は使わない。** 環境変数を無効化設定で上書きし、
毎時の同期が止まるため。イメージだけを更新する。

```bash
cd ~/vcafe-app/vcafe-dashboard
R=asia-northeast1; P=vcafe-admin-analytics; JOB=vcafe-analytics-sync
PREV=$(gcloud run jobs describe $JOB --region=$R --project=$P --format='value(spec.template.template.containers[0].image)')
echo "戻し用の旧イメージ: $PREV"
IMG=$R-docker.pkg.dev/$P/cloud-run-source-deploy/$JOB:$(git rev-parse --short HEAD)
gcloud builds submit --project=$P --region=$R --config=services/analytics-sync/cloudbuild.yaml --substitutions=_IMAGE=$IMG .
gcloud run jobs update $JOB --region=$R --project=$P --image=$IMG
```

**戻し方**: `gcloud run jobs update $JOB --region=$R --project=$P --image=$PREV`

## 手順4: 10/15〜現在を再取り込みする

欠落日の埋め戻しと、11/6以降の無料判定のやり直しを一度に行う。
`*_raw` は追記のみで、ビューが新しい行を採用するため、二重計上にはならない。

```bash
R=asia-northeast1; P=vcafe-admin-analytics; JOB=vcafe-analytics-sync
# ① 定期実行を止める（止めないとバックフィル設定のまま毎時起動してしまう）
gcloud scheduler jobs pause vcafe-analytics-sync-schedule --project=$P --location=$R
# ② 期間を指定して1回実行（UTC・終了日は含まない）。他の環境変数はそのまま。
gcloud run jobs update $JOB --region=$R --project=$P --update-env-vars=BACKFILL_FROM=2026-10-15,BACKFILL_TO=2026-11-14
gcloud run jobs execute $JOB --region=$R --project=$P --wait
# ③ 必ずバックフィル用の変数を外す
gcloud run jobs update $JOB --region=$R --project=$P --remove-env-vars=BACKFILL_FROM,BACKFILL_TO
# ④ 定期実行を再開する
gcloud scheduler jobs resume vcafe-analytics-sync-schedule --project=$P --location=$R
```

②が失敗しても、**③と④は必ず実行する。**

## 手順5: 結果を確認する

```bash
bq query --project_id=vcafe-admin-analytics --use_legacy_sql=false --format=pretty \
 'SELECT type, entryType, ticketId, COUNT(*) AS n, SUM(revenue) AS revenue
  FROM vcafe_analytics.visits_current_range("2026-11-06","2026-11-13",NULL)
  WHERE type IN ("free","trial") GROUP BY 1,2,3 ORDER BY n DESC'
bq query --project_id=vcafe-admin-analytics --use_legacy_sql=false --format=pretty \
 'SELECT DATE(TIMESTAMP_SUB(`at`, INTERVAL 2 HOUR),"Asia/Tokyo") AS d, COUNT(*) AS n, COUNTIF(type="free") AS free
  FROM vcafe_analytics.visits_current_range("2026-10-15","2026-11-13",NULL) GROUP BY d ORDER BY d'
```

**確認**:
- 1つ目で `free` が freeTicket / newUserFree / freshMaidFree に分かれ、売上が0であること
  （`entryType` 列でエラーになる場合は、ビューが新列を返していない。報告すること）
- 2つ目で、手順1で取りこぼしと判定した日の件数が Firestore と揃っていること

## 手順6: ダッシュボードを配備する

`docs/deployment-order.md` の手順2-1〜2-4（カナリア配備 → 検証 → 切替）に従う。
画面の変更点: 概要に「無料枠ご帰宅」カードと「無料枠の内訳」、明細の種別・チケット名、
ユーザー一覧に「無料枠」列。

> 2026-11-12時点でトラフィック100%は `vcafe-dashboard-18da493-0728-1916`。
> 7/29 の `ff91dad`（BigQuery のスキャン量削減）は作成済みだが切替されていない。
> 今回の配備でまとめて反映される。
