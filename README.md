# Secure Sync Memo (`v0.1.0`)

複数端末（スマートフォン・Windows・Mac）間で安全にメモを同期・管理できる、個人用エンドツーエンド暗号化（E2EE）対応の軽量 PWA（Progressive Web App）です。

詳細な要件・アーキテクチャ設計は [docs/pwa_sync_app_spec.md](./docs/pwa_sync_app_spec.md) を参照してください。

---

## 主な機能

- **クライアント側 E2EE（AES-256-GCM）**
  - Web Crypto API を用いてブラウザ内で暗号化・復号を完結させ、Cloud Firestore には暗号文（`ciphertext`）とランダム IV のみを保存します。
  - メモ本文の暗号化ごとに 12 バイトの新しいランダム IV を生成します。
- **エンベロープ暗号化（DEK / KEK）とリカバリーキー**
  - 初回セットアップ時にデータ暗号化鍵（DEK）をランダム生成し、マスターパスフレーズから PBKDF2-HMAC-SHA-256（`600,000` 回反復）で導出した KEK でラップして保存します。
  - 1 回限り表示される Base32 リカバリーキーにより、パスフレーズ忘れ時の復元・再設定に対応しています。
  - 設定画面からマスターパスフレーズの変更（DEK 再ラップ）が可能です。
- **オフライン対応・同期・競合解決**
  - Cloud Firestore の `persistentLocalCache`（マルチタブ対応）により、オフライン時でも閲覧・作成・編集が可能です。
  - 手動保存（「保存・同期」ボタン / `Ctrl + S`・`Cmd + S`）と自動デバウンス保存（2 秒）を切り替えられます。
  - 競合時は **最後の書き込み優先（LWW）** でシンプルに上書き同期します。
- **PWA / レスポンシブ UI**
  - `vite-plugin-pwa` による Service Worker・Web App Manifest を備え、ホーム画面追加やスタンドアロン起動に対応しています。
  - PC は 2 ペイン、モバイルは一覧／編集のドリルダウン表示で操作でき、ライト／ダークモードに自動適応します。
  - タイトル・タグによるインクリメンタル検索および軽量 Markdown プレビューを備えています。
- **セキュアログアウト**
  - 共有 PC での利用を想定し、ログアウト時にメモリ上の鍵の破棄に加え、Firestore の IndexedDB キャッシュ消去と画面リロードを行います。

---

## セキュリティ・データモデル概要

| パス | 用途 | 暗号化方針 |
| :--- | :--- | :--- |
| `/users/{uid}` | 鍵導出パラメータ・ラップ済み DEK・鍵検証データ | `kdfSalt` / `kdfIterations` は平文、`wrappedDek` / `keyCheck` は暗号化 |
| `/users/{uid}/notes/{noteId}` | メモメタデータおよび暗号化本文 | `title` / `tags` / `iv` / 日時は平文、`ciphertext` は AES-256-GCM 暗号化 |

[firestore.rules](./firestore.rules) ではデフォルト全拒否を前提とし、`request.auth != null && request.auth.uid == userId` の本人アクセス限定、必須フィールド・型・サイズ制限・`createdAt` の不変性を検証しています。

> **運用上の注意**: 一覧表示と検索をクライアント側で行うため、`title` と `tags` は平文で保存されます。タイトルには機密語を含めない運用を推奨します。

---

## 技術スタック

- **フロントエンド**: React 19 + TypeScript + Vite + Lucide Icons
- **PWA**: `vite-plugin-pwa`（Workbox `generateSW`）
- **暗号化**: ブラウザ標準 Web Crypto API（PBKDF2-HMAC-SHA-256 / AES-256-GCM）
- **BaaS**: Firebase JS SDK v11（Authentication / Cloud Firestore / Hosting）
- **テスト**: Vitest

---

## セットアップとローカル開発

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. Firebase 環境変数とプロジェクト設定

1. Firebase プロジェクトを作成し、**Authentication（Google ログイン）**・**Cloud Firestore（Standard Edition）**・**Firebase Hosting** を有効化します。
2. サンプルファイルをコピーして値を設定します（いずれも `.gitignore` 対象です）。

```bash
cp .env.example .env.local
cp .firebaserc.example .firebaserc
```

`.env.local` に Firebase Web アプリの設定値を記入します：

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

`.firebaserc` の `default` に Firebase プロジェクト ID を記入します。

### 3. 開発サーバー起動

```bash
npm run dev
```

ローカルテスト時は、Firebase Console の **Authentication > Settings > 承認済みドメイン** に `localhost` が含まれていることを確認してください。

---

## テスト・ビルド・デプロイ

```bash
# 暗号化モジュールの単体テスト
npm test

# TypeScript 型チェック
npm run typecheck

# 本番ビルド（dist/ 配下に PWA アセット・Service Worker を出力）
npm run build

# Firestore Security Rules と Hosting へのデプロイ
firebase deploy --only firestore:rules,hosting
```
