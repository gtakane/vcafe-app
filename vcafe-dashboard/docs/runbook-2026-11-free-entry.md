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

## 実行方法（1行ずつ貼り付けて Enter）

各手順はスクリプトにまとめてある。複数行のコードを貼る必要はない。
変更を伴う手順3・4は、実行前に内容を表示して `yes` の入力を求める。

```bash
cd ~/vcafe-app && git pull --ff-only
```

| 手順 | コマンド | 内容 | 変更 |
| --- | --- | --- | --- |
| 1 | `bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/step1-check-gap.sh` | 欠落日の確認（Firestore と BigQuery の日別件数を並べる） | なし |
| 2 | `bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/step2-add-columns.sh` | BigQuery に列を3つ追加し、全テーブルの列を照合 | 列追加のみ |
| 3 | `bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/step3-update-job-image.sh` | 同期ジョブのプログラムだけ差し替え（環境変数は触らない） | あり |
| 4 | `bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/step4-backfill.sh` | 10/15〜現在を再取り込み。定期同期の停止と再開は自動 | あり |
| 5 | `bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/step5-verify.sh` | 無料枠の内訳・日別件数・同期状態の確認 | なし |

戻し方（手順3）: `bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/rollback-job-image.sh`

### 各手順の補足

- **手順1**: 10/20 が0件、10/25 が40件だった。休業日・短縮営業か取りこぼしかを、本番の件数で判定する。
  Firestore の件数（テストユーザー分を含む）が BigQuery より明らかに多い日が取りこぼし。
- **手順2**: `apply-schema.sh` は使わない（recordKey ビュー切替後に実行すると、ビューが id ベースへ戻るため）。
  照合で今回の3列以外の不足が出た場合は、手順3へ進まない。新しい同期プログラムは起動時に列を照合し、
  不足があれば取り込みを始めずに停止する。
- **手順3**: `deploy-disabled-job-tokyo.sh` は使わない（環境変数を無効化設定で上書きし、毎時の同期が止まるため）。
  差し替え前のプログラム名は `~/.vcafe-sync-prev-image` に保存され、戻しスクリプトが使う。
- **手順4**: 欠落日の埋め戻しと、11/6以降の無料判定のやり直しを一度に行う。`*_raw` は追記のみで、
  ビューが新しい行を採用するため二重計上にはならない。途中で失敗しても、再取り込み用の設定の解除と
  定期同期の再開は自動で行う。
- **手順5**: `free` が freeTicket / newUserFree / freshMaidFree に分かれ、売上が0であること。
  `entryType` 列でエラーになる場合は、ビューが新しい列を返していないので報告する。

## 手順6: ダッシュボードを配備する

`docs/deployment-order.md` の手順2-1〜2-4（カナリア配備 → 検証 → 切替）に従う。
画面の変更点: 概要に「無料枠ご帰宅」カードと「無料枠の内訳」、明細の種別・チケット名、
ユーザー一覧に「無料枠」列。

> 2026-11-12 に `b0cb29e` を本番へ切替済み（7/29 の `ff91dad` 以降の変更をまとめて反映）。

## 追加: テスト用メイドの除外

本番環境に作られたテスト用メイド（例: うみのうみ）へのご帰宅・シフト・名簿・月次実績を集計から外す。
テストユーザーは `testUser` フラグで除外しているが、メイドには相当するフラグが無いため、
同期ジョブの環境変数 `EXCLUDED_MAID_IDS`（maidId のカンマ区切り）で指定する。

| 手順 | コマンド |
| --- | --- |
| A | `bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/step3-update-job-image.sh`（除外に対応したプログラムへ差し替え） |
| B | `bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/purge-test-maid.sh うみのうみ` |

手順Bは、名前から maidId を特定して表示し、`yes` の確認後に除外設定と取り込み済み行の削除を行う。
直近数日分は書き込み直後で BigQuery が削除を受け付けないことがあり、その場合は数日後に同じコマンドを再実行する。
削除は分析用BigQueryのみで、元データは本番に残るため、設定を外して再取り込みすれば戻せる。

> `deploy-disabled-job-tokyo.sh` で環境変数を置き換えると `EXCLUDED_MAID_IDS` も消える。

## 第2段階: 売上を経理の計上ロジックの単価に合わせる

単価は経理資料「Vあっと売上計上関連（経営管理報告用）」の未使用残高の円換算と同じ。

| 対象 | 単価（税込） |
| --- | --- |
| Apple/Googleコイン | 1.19円（1.4円からストア手数料15%を控除） |
| リワードポイント（ウェブコイン等） | 1.1円 |
| ご帰宅チケット / プレミアム / ランダム | 850円 / 960円 / 650円 × 使用枚数 |
| 記念撮影 | 500円（誕生日プレゼント等の無料チェキは除く） |
| 予約・招待 | 予約・招待を受けた時点で消費したコイン・ポイント（ご帰宅側は0円） |

アイテム購入・有効期限切れ・無償付与は含まないため、月の確定売上（経理）とは一致しない。
2026年10月の検証では、ご帰宅・予約・招待の合計は経理の約97%（Apple/Googleはアイテム購入分だけ不足）。

| 手順 | コマンド |
| --- | --- |
| 1 | `bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/step7-revenue-tables.sh`（列・テーブル・ビューの追加） |
| 2 | `bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/step3-update-job-image.sh`（同期プログラムの差し替え） |
| 3 | `bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/step4-backfill.sh 2026-10-01`（10月以降を1か月ずつ再取り込み＋予約・招待の初回取り込み。中断したら restore-sync.sh） |
| 4 | `bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/verify-revenue.sh 2026-10`（経理の10月と比較） |
| 5 | `bash ~/vcafe-app/vcafe-dashboard/deploy-revision-tokyo.sh` → 検証用URLで確認 |
| 6 | `bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/promote-latest-canary.sh`（版の名前を写さずに切替） |

> 手順1を飛ばして手順2以降を行うと、同期は起動時の列照合で停止し、ダッシュボードは表示時にエラーになる。

## 第4段階・第2段階後半: グロース指標と、未使用残高・月の確定売上

追加する指標（グロース指標の画面）:
新規登録数と14日以内の初回課金率／新規ユーザー無料からの有料化率／新人メイド無料からの有料再訪率／
月ごとの課金者数・1人あたり課金額・有料利用者数・1人あたり利用額／登録月ごとの課金継続率／未使用残高（前受金）の推移。

月の確定売上（概要画面）は経理と同じ「購入額＋前月末の未使用残高−当月末の未使用残高」。
未使用残高は毎日朝5時に全会員の合計を `balance_snapshots` へ1行記録する（個人単位では保存しない）。
11/1時点は経理の書き出しを基準値として登録するため、11月分は12/1朝の記録後に確定する。

| 手順 | コマンド |
| --- | --- |
| 1 | `bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/step8-balances.sh` |
| 2 | `bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/step3-update-job-image.sh` |
| 3 | `bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/step4-backfill.sh 2026-10-01`（課金の購入元・全会員の残高・最初の残高記録） |
| 4 | `bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/verify-purchases.sh 2026-10`（課金台帳と各社の報告の比較） |
| 5 | `bash ~/vcafe-app/vcafe-dashboard/deploy-revision-tokyo.sh` → 検証用URLで確認 → `promote-latest-canary.sh` |

## 毎朝5時の自動処理（取りこぼし検知）

同期ジョブは毎朝5時の回で、次を自動で行う。

1. 全会員の未使用残高の合計を `balance_snapshots` に1行記録する。
2. 直近7営業日（JST 2:00〜翌2:00）について、本番のご帰宅件数とダッシュボードの件数を比べる。
   差が「5件または5%の大きい方」を超えた日は、その日を取り込み直す。
3. 取り込み直した日は、読んだ本番の記録からテストユーザー・テスト用メイドの分を除いた件数で判定し直し、
   結果を `dq_results` に残す。合格しなかった日は、ダッシュボードの鮮度表示に欠落として出る。

今すぐ1回実行して結果を見る:
`bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/run-daily-checks-now.sh`

| 列 | 意味 |
| --- | --- |
| production | 本番の全件（テストユーザー・テスト用メイドを含む） |
| dashboard | ダッシュボード側の件数 |
| expected_excl_test | 取り込み直した日だけ。テストの分を除いた件数（判定に使う） |
| unresolved_maid | メイドを特定できず取り込めなかった件数。0でなければ実データの欠けで、名簿に無いメイドなどを調べる |

> 2026-11-06（無料ご帰宅の公開日）は本番219件・ダッシュボード201件で、差18件はすべてテストの分だった。

## 月初の作業（毎月）

月の確定売上（概要画面）を経理と一致させるため、前月分の各社の報告額を登録する。

`bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/set-platform-purchases.sh 2026-11 <Apple> <Google> <Stripe>`

| 値 | 確認先 |
| --- | --- |
| Apple | App Store Connect「支払と財務報告」の推定収益（手数料控除後・Appleの会計月。11月は 11/1〜11/28） |
| Google | Google Play のお支払いプロファイルの当月分（手数料控除後） |
| Stripe | Stripe の当月の決済額（総額） |

未登録の月は課金台帳から推計した値で計算し、「暫定」と表示する。登録すると「確定」になる。
前月の確定には当月1日朝の残高記録が必要（11月分は 12/1 朝5時の記録後に確定）。

> Google は 2026年10月、課金台帳からの推計（236,177円）が経理の値（188,615円）より約25%多く、原因は未特定。
> 報告額を登録すれば確定売上には影響しない。

## 第5段階: テストユーザーの切り替え・ご帰宅数の数え方・月次指標（2026-11-12）

- **テストユーザー**: 同期がテストユーザーの記録も `isTestUser=true` を付けて取り込むようにした。ダッシュボードの右上
  「テストユーザー 除く／含む」で全画面の数値を切り替える（管理者のみ・既定は除く）。メイドの月次実績はアプリの集計値のため対象外。
  未使用残高は除いた合計と含めた合計を毎朝2行記録する。含めた側の確定売上は、記録が始まった翌月（12月）から出る。
- **ご帰宅数**: 通常ご帰宅は滞在時間÷20分（20分未満は0.5件）、予約・お試し・無料ご帰宅は1回を1件として別枠で数え、合計を出す。
- **月次指標**（左の「月次指標」）: 運営の月次CSVと同じ項目。2026年10月以前はCSVの値を正とし、データから出し直した値と違う項目に「≠」。
  11月以降は自動。メイド報酬だけ手入力。出来事は公式サイトのお知らせ、入店・退店はシフトから出す。

**順番が大事。** 同期を先に差し替えると、切り替えの無い今のダッシュボードにテストユーザーの数値が混ざる。

| 手順 | コマンド | 内容 |
| --- | --- | --- |
| 1 | `bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/step9-test-user-columns.sh` | テストユーザーの印の列を追加 |
| 2 | `bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/step11-monthly-kpi-tables.sh` | 月次指標の表（CSVの記録・メイド報酬）を作成 |
| 3 | `bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/import-monthly-kpi-csv.sh ~/<CSVのファイル名>` | 運営の月次CSVを取り込む（先に Cloud Shell へアップロード） |
| 4 | `bash ~/vcafe-app/vcafe-dashboard/deploy-revision-tokyo.sh` → 検証用URLで確認 → `promote-latest-canary.sh` | ダッシュボードを配備 |
| 5 | `bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/step3-update-job-image.sh` | 同期プログラムの差し替え（以降テストユーザーも取り込む） |
| 6 | `bash ~/vcafe-app/vcafe-dashboard/services/analytics-sync/runbook-2026-11/step10-import-test-users.sh` | テストユーザーの過去分を取り込む |

毎月: `set-maid-reward.sh 2026-11 <メイド報酬の合計>`（メイド報酬）、`set-platform-purchases.sh`（各社の報告額。売上が確定になる）。

> CSV は売上・報酬・メイド名を含むため、公開リポジトリには置かない（Cloud Shell にアップロードして取り込むだけ）。
