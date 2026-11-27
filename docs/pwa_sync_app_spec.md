# 個人用セキュア同期メモ PWA 要件・設計書および実装指示書

本書は、複数端末（スマートフォン・Windows・Mac）間でテキスト情報等を安全に同期・管理する軽量 PWA（Progressive Web App）について、ローカル開発エージェント（Antigravity）が実装を進めるための要件定義・アーキテクチャ設計・実装指示をまとめたドキュメントです。

---

## 1. プロジェクト概要と基本要件

| 項目 | 決定事項・方針 |
| :--- | :--- |
| **アプリ形態** | 軽量な Web アプリ（PWA：ホーム画面追加・スタンドアロン起動・オフライン閲覧対応） |
| **対象端末** | スマートフォン（iOS Safari / Android Chrome）、PC（Windows / Mac の Chrome・Edge 等） |
| **利用範囲** | 個人利用（他者とのデータ共有・共同編集機能は MVP では実装しない） |
| **インフラ基盤** | Google Cloud / Firebase 統一（Authentication・Cloud Firestore・Hosting） |
| **コスト方針** | Firebase Spark（無料）プランの無料枠内で運用可能な設計（[Firebase Pricing](https://firebase.google.com/pricing)） |
| **セキュリティ** | クライアント側エンドツーエンド暗号化（E2EE）と Firebase Security Rules の併用 |
| **同期・競合** | 自動同期または 1 アクション（同期ボタン等）による同期。競合時は **最後の書き込み優先（LWW）** で上書き |

---

## 2. 推奨技術スタック

軽量性と PWA 対応のしやすさ、Web Crypto API / Firebase SDK との親和性を重視した構成です。

* **フロントエンド**: TypeScript + Vite + React（または Preact / Svelte 等の軽量フレームワーク）
* **PWA 化**: `vite-plugin-pwa`（Service Worker 自動生成、`manifest.json` 設定、App Shell キャッシュ）
* **BaaS / 基盤**: Firebase JS SDK（v9 以降のモジュラー形式）
  * **認証**: Firebase Authentication（Google ログイン等。Spark プランで月間 50,000 MAU まで無料）
  * **データベース**: Cloud Firestore（Spark プランで 1 GiB ストレージ・読み取り 50,000 回/日・書き込み 20,000 回/日まで無料）
  * **ホスティング**: Firebase Hosting（無料 SSL 配信・CDN）
* **暗号化**: ブラウザ標準の [Web Crypto API](https://developer.chrome.com/docs/modern-web-guidance/guides/security/client-side-encryption)（外部の暗号化ライブラリは原則不要）

---

## 3. データモデル設計（Cloud Firestore）

メタデータ（一覧表示・ソート・タイトル検索用）のみ平文で保持し、本文や機密設定項目はすべてクライアント側で暗号化してから保存するハイブリッド構成とします。

### 3.1 ユーザー設定・鍵管理ドキュメント: `/users/{uid}`

| フィールド名 | 型 | 暗号化 | 説明 |
| :--- | :--- | :--- | :--- |
| `kdfSalt` | `string` | 平文 | PBKDF2 用のランダムソルト（16 バイト以上、Base64） |
| `kdfIterations` | `number` | 平文 | PBKDF2 の反復回数（初期値: `600000`） |
| `wrappedDek` | `object` | 暗号化 | KEK で暗号化した DEK（`{ iv: string, data: string }`） |
| `keyCheck` | `object` | 暗号化 | パスフレーズ／DEK の正誤判定用ダミー暗号データ（`{ iv: string, data: string }`） |
| `updatedAt` | `timestamp` | 平文 | 鍵設定の最終更新日時 |

### 3.2 メモドキュメント: `/users/{uid}/notes/{noteId}`

| フィールド名 | 型 | 暗号化 | 説明 |
| :--- | :--- | :--- | :--- |
| `title` | `string` | 平文 | 一覧表示・ローカル検索用のタイトル（機密語を含めない運用を推奨） |
| `tags` | `string[]` | 平文 | 分類用タグ（任意・検索用） |
| `iv` | `string` | 平文 | 本文暗号化に使用した 12 バイトのランダム IV（Base64） |
| `ciphertext` | `string` | **E2EE** | AES-256-GCM で暗号化した本文・機密設定の JSON 文字列（Base64） |
| `encVersion` | `number` | 平文 | 暗号化フォーマットバージョン（初期値: `1`） |
| `createdAt` | `timestamp` | 平文 | 作成日時 |
| `updatedAt` | `timestamp` | 平文 | 最終更新日時（同期・並び替え用） |
| `isDeleted` | `boolean` | 平文 | 論理削除フラグ（オフライン同期時の削除反映用、任意） |

---

## 4. セキュリティ・暗号化設計（E2EE + リカバリーキー）

パスフレーズの変更やリカバリーキーによる復旧を容易にするため、**エンベロープ暗号化（DEK / KEK の 2 層構造）** を採用します。

### 4.1 鍵の役割と導出仕様

1. **DEK（データ暗号化鍵）**:
   * 初回セットアップ時にブラウザ内でランダム生成する **AES-256-GCM** 鍵（256 ビット）。
   * メモ本文（`ciphertext`）および `keyCheck` の暗号化・復号に使用します。
2. **KEK（鍵暗号化鍵）**:
   * ユーザーが入力したマスターパスフレーズと `kdfSalt` から、**PBKDF2（HMAC-SHA-256）** で導出する鍵です。
   * 反復回数は [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) の推奨基準に従い **600,000 回以上** に設定します。
   * DEK をラップ（暗号化）して `wrappedDek` として Firestore に保存するためだけに使用します。
3. **リカバリーキー**:
   * 初回セットアップ時にのみ、生成した DEK の生バイト列を Base32 や 16 進数等の読みやすい文字列として 1 度だけ画面に表示し、ユーザーに安全な場所へ控えてもらいます。
   * パスフレーズを忘れた場合でも、リカバリーキーから DEK をインポートしてデータを復号し、新しいパスフレーズで DEK を再ラップできます。

### 4.2 暗号化・復号の厳守事項

* **IV（初期化ベクトル）の使い回し禁止**: `crypto.subtle.encrypt` を呼ぶたびに `crypto.getRandomValues(new Uint8Array(12))` で新しい 12 バイトの IV を生成し、暗号文と一緒に保存してください。
* **鍵のメモリ／ブラウザ保持**: 復号に使う DEK は原則メモリ上の State に保持し、平文のパスフレーズや生 DEK 文字列を `localStorage` や Cookie に保存しないでください（利便性のために端末内キャッシュを行う場合も、`extractable: false` の `CryptoKey` として IndexedDB に格納し、ログアウト時に必ず削除すること）。

### 4.3 Firebase Security Rules

認証済み本人の `uid` に一致するパス以外へのアクセスをすべて拒否します（[Security Rules and Firebase Authentication](https://firebase.google.com/docs/rules/rules-and-auth)）。

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

---

## 5. 同期・オフライン・PWA 設計

### 5.1 オフライン永続化と同期タイミング

* **Firestore オフラインキャッシュ**: Web SDK の初期化時に `persistentLocalCache({ tabManager: persistentMultipleTabManager() })` を有効化し、オフライン時でも IndexedDB から即座に読み書きできるようにします（[Access data offline | Firestore](https://firebase.google.com/docs/firestore/manage-data/enable-offline)）。
* **同期トリガー（1 アクション または 自動）**:
  * **推奨（ハイブリッド方式）**: 編集中はローカル State / IndexedDB に下書きを保持し、**「保存・同期」ボタン押下時**（または編集終了・フォーカス離脱後のデバウンス）に暗号化して Firestore へ `setDoc` します。これにより無料枠の書き込み回数を節約でき、編集途中の意図しない上書きを防げます。
  * **状態表示**: ヘッダー等に「同期済み / 未保存の変更あり / オフライン（同期待ち）」のステータスバッジを表示してください。

### 5.2 競合（コンフリクト）解決

* 個人利用を前提とし、複雑化を避けるため **最後の書き込み優先（Last Write Wins）** を採用します。
* Firestore の標準挙動および `updatedAt` ベースの上書きとし、特殊なマージ UI は実装しません。

### 5.3 PWA・マルチ端末要件

* `manifest.json` に適切なアプリ名・アイコン（192x192, 512x512）・`display: "standalone"`・`theme_color` を設定すること。
* レスポンシブ UI（スマホの片手操作を意識した下部/上部アクションバーと、PC でのキーボードショートカット `Ctrl/Cmd + S` 等に対応）。
* 共有 PC での利用に備え、ログアウト時には IndexedDB の Firestore キャッシュおよびメモリ上の鍵を確実に破棄する処理を実装すること。

---

## 6. 画面・機能要件（MVP）

1. **ログイン画面**: Firebase Auth（Google ログインボタン等）によるサインイン。
2. **初回暗号化セットアップ画面**（`/users/{uid}` が未作成の場合）:
   * マスターパスフレーズの登録（強度チェック・確認入力）。
   * DEK 生成・リカバリーキーの 1 回限りの表示と「控えました」確認チェック。
3. **ロック解除画面**（ログイン済み・メモリ上に DEK がない場合）:
   * マスターパスフレーズ入力による `wrappedDek` 復号と `keyCheck` 検証。
   * 「リカバリーキーで復元する」導線。
4. **メイン画面（一覧・検索・編集）**:
   * 左ペイン（PC）/ 一覧画面（スマホ）: メモタイトル・更新日時一覧、平文タイトルでのインクリメンタル検索、新規作成ボタン。
   * 右ペイン（PC）/ 詳細画面（スマホ）: タイトル入力欄、本文テキストエリア（Markdown プレビューは任意）、**保存・同期ボタン**、削除ボタン。
5. **設定モーダル / 画面**:
   * マスターパスフレーズの変更（現在のパスフレーズで DEK を復号し、新しいパスフレーズで再ラップ）。
   * 同期モード設定（手動ボタン保存 / 自動デバウンス保存の切り替えなど任意）。
   * ログアウト（ローカルキャッシュ消去付き）。

---

## 7. Antigravity 向け実装指示書

ローカル PC 上の Antigravity は、以下の順序と制約に従ってプロジェクトを構築してください。

### 7.1 実装ステップ

1. **Step 1: プロジェクト初期化**
   * Vite + TypeScript（React 等）でプロジェクトを作成し、`firebase` と `vite-plugin-pwa` を導入する。
   * 環境変数（`.env.local`）で Firebase 設定（`VITE_FIREBASE_API_KEY` 等）を読み込めるようにし、`.gitignore` に `.env*` を含める。
2. **Step 2: 暗号化モジュール（`src/lib/crypto.ts`）の実装と単体テスト**
   * `deriveKekFromPassphrase(passphrase, salt, iterations)`
   * `generateDek()` / `exportRecoveryKey(dek)` / `importRecoveryKey(recoveryKey)`
   * `wrapDek(dek, kek)` / `unwrapDek(wrappedDek, kek)`
   * `encryptText(plainText, dek)` / `decryptText(ciphertext, iv, dek)`
   * まずは暗号化・復号・リカバリーキー復元のユニットテスト（Vitest 等）を作成し、すべてパスすることを確認する。
3. **Step 3: Firebase 連携とデータアクセス層（`src/lib/firebase.ts`, `src/lib/notes.ts`）**
   * Firebase Auth 初期化、Firestore 初期化（`persistentLocalCache` 有効化）。
   * `firestore.rules` ファイルを作成し、第 4.3 節の Security Rules を記述する。
4. **Step 4: UI・PWA・同期ロジックの実装**
   * 第 6 節の全画面・状態遷移（未ログイン → 初回セットアップ or ロック解除 → メイン画面）を実装する。
   * `vite-plugin-pwa` の設定を行い、ビルド後に Service Worker と Manifest が正しく認識されることを確認する。
5. **Step 5: 動作確認とセキュリティチェック**
   * Firestore コンソール上で `ciphertext` が暗号化文字列になっており、平文が保存されていないことを目視確認する。
   * 2 つの異なるブラウザ（またはシークレットウィンドウ）で同一アカウントにログインし、メモの同期と LWW 上書きが動作することを確認する。

### 7.2 実装時の禁止事項・注意点

* 暗号文・パスフレーズ・DEK・リカバリーキーを `console.log` 等に出力しないこと。
* AES-GCM の IV を固定値にしたり使い回したりしないこと。
* Firebase の API キーをハードコードせず環境変数から読み込むこと（公開設定であっても構成管理のため分離する）。
* 大量の不要な `onSnapshot` リスナーや高頻度な書き込みループを発生させず、Spark プランの無料枠を意識した実装にすること。
