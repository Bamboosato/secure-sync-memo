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
- **メモのピン止め・同一エリア内並び替え・モバイルスワイプ操作**
  - メモをピン止めして「ピン止め」と「その他のメモ」の表示エリアに分離でき、両エリアが揃う場合は薄い境界線で区切って表示します（ピン止め／解除時は移動先エリアの先頭へ配置）。
  - 同一エリア内で中点法（`sortOrder`）による並び替えに対応しており、通常は 1 ドキュメントのみの更新で無料枠の書き込みを抑えつつ、編集・保存後も手動の並び順を維持します（間隔が狭まった場合のみ自動リバランス）。
  - **操作方法**: カード長押しドラッグ（マウス・タッチ）による並び替え、キーボードの `↑` / `↓`（`Home` / `End`）によるエリア横断のアクティブメモ切替え、`Shift + ↑` / `↓` による同一エリア内の並び替えに対応しています。
  - **モバイルスワイプ**: スマホ幅ではカードを右へスライドしてピン止め／解除、左へスライドして削除ボタン（確認ダイアログ付き）を表示できます。
- **プレビュー優先表示・閲覧モード**
  - 既存メモを選択した際はデフォルトで Markdown プレビュー表示となり（タブ順は左「プレビュー」、右「編集」）、新規メモ作成時は編集タブから開始します。
  - プレビュー表示中はタイトル・タグも閲覧専用となり、モバイル閲覧時の誤タップによるキーボード起動を防ぎます。
- **オフライン対応・同期・競合解決**
  - Cloud Firestore の `persistentLocalCache`（マルチタブ対応）により、オフライン時でも閲覧・作成・編集が可能です。
  - 手動保存（「保存・同期」ボタン / `Ctrl + S`・`Cmd + S`）と自動デバウンス保存（2 秒）を切り替えられます。
  - 競合時は **最後の書き込み優先（LWW）** でシンプルに上書き同期します。
- **PWA / レスポンシブ UI**
  - `vite-plugin-pwa` による Service Worker・Web App Manifest を備え、ホーム画面追加やスタンドアロン起動に対応しています。
  - 手動更新方式（`registerType: 'prompt'`）と更新通知バナーを採用しており、新バージョン公開時もロック解除直後や編集中の意図しない自動リロードを防ぎます。
  - PC は 2 ペイン、モバイルは一覧／編集のドリルダウン表示で操作でき、ライト／ダークモードに自動適応します。
  - タイトル・タグによるインクリメンタル検索を備えています（検索・タグ絞り込み中もピン止め操作は可能）。
- **端末内鍵キャッシュ・iOS 自動入力対応・セキュアログアウト**
  - 個人用端末向けに「この端末では次回からパスフレーズを省略する」オプションを備えており、平文パスフレーズや生 DEK は保存せず、`extractable: false` の `CryptoKey` のみを端末内の IndexedDB に保持します（共有端末ではオフで利用可能）。
  - パスフレーズフォームに `autoComplete="username"` を併用し、iOS Safari / iCloud キーチェーン（Face ID）等でのパスワード保存・自動入力に対応しています。
  - 「今すぐロック」時はメモリおよび端末内キャッシュの鍵を破棄し、「ログアウト」時はさらに Firestore の IndexedDB キャッシュ消去と画面リロードを行います。

---

## セキュリティ・データモデル概要

| パス | 用途 | 暗号化方針 |
| :--- | :--- | :--- |
| `/users/{uid}` | 鍵導出パラメータ・ラップ済み DEK・鍵検証データ | `kdfSalt` / `kdfIterations` は平文、`wrappedDek` / `keyCheck` は暗号化 |
| `/users/{uid}/notes/{noteId}` | メモメタデータおよび暗号化本文 | `title` / `tags` / `isPinned` / `sortOrder` / `iv` / 日時は平文、`ciphertext` は AES-256-GCM 暗号化 |

[firestore.rules](./firestore.rules) ではデフォルト全拒否を前提とし、`request.auth != null && request.auth.uid == userId` の本人アクセス限定、必須フィールド・型・サイズ制限・`createdAt` の不変性に加え、既存ドキュメント互換の任意フィールドとして `isPinned`（`bool`）および `sortOrder`（有限範囲の `number`）を検証しています。

> **運用上の注意**: 一覧表示と検索をクライアント側で行うため、`title` と `tags` は平文で保存されます。タイトルには機密語を含めない運用を推奨します。

---

## 技術スタック

- **フロントエンド**: React 19 + TypeScript + Vite + Lucide Icons + `@dnd-kit`（並び替え）
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
# 暗号化・並び替え・端末鍵キャッシュモジュールの単体テスト
npm test

# TypeScript 型チェック
npm run typecheck

# 本番ビルド（dist/ 配下に PWA アセット・Service Worker を出力）
npm run build

# Firestore Security Rules と Hosting へのデプロイ
firebase deploy --only firestore:rules,hosting
```
