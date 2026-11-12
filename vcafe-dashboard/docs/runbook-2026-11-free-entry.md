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

> 2026-11-12時点でトラフィック100%は `vcafe-dashboard-18da493-0728-1916`。
> 7/29 の `ff91dad`（BigQuery のスキャン量削減）は作成済みだが切替されていない。
> 今回の配備でまとめて反映される。
