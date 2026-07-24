# 確定プロジェクト構成

|用途|プロジェクトID|
|---|---|
|既存の本番Firebase|`v-athome-cafe-app`|
|新規の管理・分析用Firebase / Google Cloud|`vcafe-admin-analytics`|

FirebaseプロジェクトはGoogle Cloudプロジェクトでもあるため、管理用Firestore、Firebase Authentication、Firebase Hosting、BigQuery、Cloud Runは`vcafe-admin-analytics`側に作成します。Next.jsの実行環境は東京リージョン（`asia-northeast1`）のCloud Runです。

## 安全境界

- `v-athome-cafe-app`には既存アプリのデータだけを保持します。
- 新しいWebアプリとDiscord Botは`v-athome-cafe-app`へ書き込みません。
- 同期専用サービスアカウントだけが`v-athome-cafe-app`を読み取ります。
- 同期専用サービスアカウントの本番権限は`roles/datastore.viewer`だけにします。
- BigQuery、管理用Firestoreへの書き込み権限は`vcafe-admin-analytics`側だけに付与します。

## 確定済みのWebアプリ設定

```text
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=vcafe-admin-analytics.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=vcafe-admin-analytics
NEXT_PUBLIC_FIREBASE_API_KEY=Firebase Webアプリ登録で発行済み
NEXT_PUBLIC_FIREBASE_APP_ID=Firebase Webアプリ登録で発行済み
```

これらはFirebase Web設定値でありサービスアカウント秘密鍵ではありません。サービスアカウントJSONは作成・共有・リポジトリ保存しません。

## Authentication権限

Firebase AuthenticationのCustom Claimsは`scripts/set-auth-claims.ts`で設定します。スクリプトは`vcafe-admin-analytics`以外では停止し、既定ではドライランです。UIDはソースコードや設定ファイルへ保存せず、実行時引数として渡します。
