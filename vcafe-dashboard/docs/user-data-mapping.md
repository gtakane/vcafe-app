# ユーザーデータのマッピング

本番Firestoreのフィールド名は変更しません。同期処理で既存フィールドを分析用の共通スキーマへ変換します。

## 確認済みの既存フィールド

`users/{userId}`について、次のフィールド名で確定しました。

|用途|本番Firestoreフィールド|型|
|---|---|---|
|ユーザーID|FirestoreドキュメントID|文字列|
|表示名|`nickname`|文字列|
|ランク|`rank`|文字列|
|登録日時|`registrationDate`|Timestamp|
|テストユーザー除外|`testUser`|boolean|
|テストユーザー除外|`testUesrFlag`|boolean（本番側の綴りをそのまま使用）|

## 分析用スキーマ

同期後のBigQuery `customers_current`は次の形に統一します。

```json
{
  "id": "元のFirestoreドキュメントIDを分析環境で変換したID",
  "name": "表示名",
  "rank": "ブロンズ | シルバー | ゴールド | プラチナ",
  "registeredAt": "2024-06-17T11:00:10.000Z または null"
}
```

`registrationDate`はUTC+9で表示されるFirestore Timestampです。分析環境にはISO 8601 UTCで保持し、画面では日本時間へ戻して表示します。欠損時はユーザーを除外せず「未設定」と表示します。`testUser`と`testUesrFlag`は、どちらか一方でも`true`なら同期対象から除外します。

`rank`は文字列としてそのまま保持します。画面側は固定のランク一覧に依存せず、実データに存在するランク値を自動的に集計します。

本番から取得したユーザーIDは管理用プロジェクトで不可逆変換し、メイド画面には元IDも表示名も送信しません。管理者だけが表示名を閲覧できるようにします。
