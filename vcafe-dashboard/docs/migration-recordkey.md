# データモデル移行手順（recordKey / 課金カバレッジ）

指摘6・7に対応する移行。**本手順は本番未適用**。適用は運営側の判断で行う。

## 何を変えるか

| 対象 | 変更前 | 変更後 |
| --- | --- | --- |
| 重複排除キー | `document.id` | `recordKey` = HMAC(Firestoreフルパス) |
| BigQuery insertId | `id:sourceUpdatedAt` | `recordKey:sourceUpdatedAt` |
| current の並び順 | `syncedAt DESC` | `sourceUpdatedAt DESC, syncedAt DESC, runId DESC` |
| `customers_raw.sourceUpdatedAt` | 常に `null` | Firestore の `updateTime` |
| 課金の旧ソース除外 | 台帳が1件でもあれば**全期間**除外 | **月単位のカバレッジ**で判定 |
| 失敗決済 | 売上に混入 | `status` で除外 |

## なぜ必要か

**recordKey**: `userRecordVisits` などは collection group で読むため、`document.id` は
親（ユーザー）が違えば重複し得る。`id` を一意前提にした `insertId` と
`ROW_NUMBER(PARTITION BY id)` の下では、別ユーザーの同名ドキュメントが衝突して
片方が消える。フルパスの HMAC なら親が違えば必ず別キーになる。
生パス・生UIDは分析側に保存しない（不可逆変換した結果だけを持つ）。

**課金カバレッジ**: 旧実装は `(SELECT COUNT(*) FROM ledger) = 0` で切り替えていたため、
`userPayments` が1件でも入った瞬間に旧ソースが全期間で除外された。
部分バックフィル中・インデックス障害・特定月の欠損でも旧データが丸ごと消える。

## 適用順序

> ⚠️ **③の前に必ず `gcloud scheduler jobs pause vcafe-analytics-sync-schedule` で
> 定期実行を止める。** 2026-07-29、止めずにバックフィルを実行したところ、作業中に
> 毎時の定期実行が発火し、バックフィル用の環境変数（`BACKFILL_FROM`/`BACKFILL_TO`/
> 緩めた`REJECT_RATE_THRESHOLD`）のまま実行されてしまい、本来の増分同期の代わりに
> 同じ期間のバックフィルが重複実行された（詳細は `docs/enable-sync-runbook.md` 手順8）。
> ③が終わったら忘れず `gcloud scheduler jobs resume ...` で再開する。

```
① コード配備（イメージ再ビルド）
   bash services/analytics-sync/deploy-disabled-job-tokyo.sh

② 列追加（既存データは変わらない・ビューは id ベースのまま）
   bash services/analytics-sync/apply-schema.sh

③ 全期間の再バックフィル ← ここで全行に recordKey が入る
   4区間に分けて実行（docs/enable-sync-runbook.md の手順8）

④ 検証（下記の全項目が期待どおりであること）

⑤ ビュー切替（原子的。ここではじめて recordKey ベースになる）
   bash services/analytics-sync/apply-migration.sh 001-record-key-dedup.sql

⑥ 再検証（④と同じクエリで件数・金額が一致すること）
```

**③を飛ばして⑤を適用してはいけない。** `recordKey` が NULL の旧行と
`recordKey` を持つ新行が別パーティションになり、同じドキュメントが二重に現れる。

## ④ 検証クエリ

```bash
bash services/analytics-sync/verify-migration.sh
```

判定基準:

| 検査 | 期待値 |
| --- | --- |
| `recordKey IS NULL` の行数（全 raw 表） | **0**。1件でもあれば③が未完了 |
| `recordKey` の重複（同一 recordKey で異なる `id`） | 0。HMAC 衝突が無いこと |
| 切替前後の `visits_current` 件数 | 一致（増えるなら旧実装で消えていた分、減るなら要調査） |
| 切替前後の `payments_current` 年別金額 | 台帳がある月は一致、無い月は旧ソース分が残る |
| `sourceUpdatedAt IS NULL` の `customers_raw` | 再バックフィル後は0に近づく |

**件数が「増える」のは正常**（衝突で消えていた行が復活する）。
**減る場合は必ず調査する**（失敗決済の除外による減少は `payments_current` のみ想定）。

## ロールバック

ビュー定義のみの変更なので、**データを触らずに戻せる**。

```bash
# 切替前のビュー定義（id ベース）へ戻す
bash services/analytics-sync/apply-schema.sh
```

`schema.sql` は id ベースのビュー定義を保持したままなので、再適用すれば元に戻る。
`recordKey` / `runId` 列は残るが、id ベースのビューはそれらを参照しないため無害。

②の列追加は `ADD COLUMN IF NOT EXISTS` であり、既存行の値を変えない。
③の再バックフィルは `*_raw` への追記のみで、既存行を更新も削除もしない。
したがって**どの段階からでも②の状態へ戻せる**。

## 既知の制約

- **削除の検知ができない。** Firestore で削除されたドキュメントは、追記型の `*_raw` からは
  消えない。現状は検知手段が無く、`sync_rejects` などの仕組みでも捕捉できない。
  対策には「全件スナップショットを取り、分析側に存在してソースに無い recordKey を洗い出す」
  reconciliation ジョブが必要（未実装）。
- **`payments_current` の月カバレッジは「その月に台帳の行が1件でもあるか」で判定する。**
  台帳がその月を部分的にしかカバーしていない場合、旧ソース側の残りは補完されない。
  正確を期すなら取引キー単位の突合が必要だが、`payments` と `userPayments` に
  共通の取引IDが無いため現状は実装できない（`transactionId` はアプリ内課金のみ）。
- **HMAC の鍵を変更すると全 recordKey が変わる。** 鍵をローテーションする場合は
  全期間の再バックフィルが必要（`docs/project-config.md` に記載）。
