# Firestore → BigQuery 分析同期

本番Firestoreから最大24時間の限定範囲を読み取り、別プロジェクトのBigQueryへ分析用データを保存するCloud Run Jobです。コード内にFirestoreの書き込み処理はありません。

## 起動前の安全条件

- 本番と分析用プロジェクトIDが異なることを強制します。
- `CONFIRM_READ_ONLY_SYNC=I_UNDERSTAND_THIS_READS_PRODUCTION`がなければ、Firestoreへ接続する前に終了します。
- 1回の取得期間は最大24時間、各コレクショングループ最大10,000件です。
- `DRY_RUN`は既定で`true`です。BigQueryへ書く場合だけ`false`にします。
- ユーザーIDはHMAC-SHA256で不可逆変換してから分析環境へ送ります。
- `testUser`または`testUesrFlag`が有効なユーザーは除外します。

## 必要な環境変数

```text
CONFIRM_READ_ONLY_SYNC=I_UNDERSTAND_THIS_READS_PRODUCTION
PRODUCTION_PROJECT_ID=v-athome-cafe-app
ANALYTICS_PROJECT_ID=vcafe-admin-analytics
BIGQUERY_DATASET=vcafe_analytics
BIGQUERY_LOCATION=asia-northeast1
CUSTOMER_ID_HMAC_SECRET=Secret Managerから注入する32文字以上の秘密値
SYNC_LOOKBACK_MINUTES=90
MAX_DOCUMENTS=5000
DRY_RUN=true
```

過去データの限定バックフィルでは`SYNC_START`と`SYNC_END`をISO 8601で両方指定します。最大24時間ごとに分割してください。

## IAM

同期専用サービスアカウントには、本番プロジェクトで`roles/datastore.viewer`だけを付与します。`roles/datastore.user`、`roles/datastore.owner`、Firebase Admin相当の権限は付与しません。分析用プロジェクトでは対象データセットへのBigQuery Data EditorとBigQuery Job Userだけを付与します。

## テーブル作成

`apply-schema.sh` が `schema.sql` の `PROJECT_ID`/`DATASET_ID` を置換し、分析用プロジェクトにデータセット・履歴テーブル・重複排除ビューを作成します（分析用プロジェクトにのみ書き込む安全な操作）。

```bash
./services/analytics-sync/apply-schema.sh
```

`visits_raw` には滞在時間の重み `weight`（core.py の `visitWeight` と一致）を保持し、日次集計は営業日（0:00〜1:59を前日扱い）で行います。

## 本番Firestoreのインデックス（多くの場合は不要）

collectionGroup範囲クエリのため COLLECTION_GROUP スコープの単一フィールドインデックスが必要ですが、既存 Streamlit が本番で同じクエリを実行できていれば既に存在します。不足時のみ dry-run が `FAILED_PRECONDITION` を返し、**エラー内のURLから必要なインデックスだけを追加作成**できます（定義は `firestore.indexes.json`）。

> ⚠️ 部分的なインデックス定義を `firebase deploy --only firestore:indexes` で流すと本番アプリの既存インデックス削除を促される場合があるため、エラーリンク経由の追加を推奨します。

## 有効化手順

初回の非接続デプロイから実稼働までの各ステップ（スキーマ適用・インデックス・HMACシークレット・本番読み取りIAM・DRY_RUN確認・Scheduler）は `../../docs/enable-sync-runbook.md` を参照してください。

## コンテナ作成

リポジトリルートから次を実行します。

```powershell
docker build -f services/analytics-sync/Dockerfile -t vcafe-analytics-sync .
```

本番で動かす前に、分析用の複製プロジェクトまたはエミュレーターで`DRY_RUN=true`の件数確認を行います。

## 本番非接続の初回デプロイ

`deploy-disabled-job-tokyo.sh`は、管理・分析用プロジェクトに停止状態のCloud Run Jobを作成します。

- 配置先は`vcafe-admin-analytics`、リージョンは`asia-northeast1`に固定しています。
- `CONFIRM_READ_ONLY_SYNC=DISABLED`のため、誤って手動実行してもFirestore接続前に終了します。
- 本番プロジェクトへのIAM付与は行いません。
- Cloud Schedulerは作成せず、デプロイ後にジョブを実行しません。
- `DRY_RUN=true`、15分、100件の最小設定を保持します。

リポジトリルートから次を実行します。

```bash
chmod +x services/analytics-sync/deploy-disabled-job-tokyo.sh
./services/analytics-sync/deploy-disabled-job-tokyo.sh
```

本番読み取りを有効化する変更は、この初回デプロイとは分離してレビューしてください。
