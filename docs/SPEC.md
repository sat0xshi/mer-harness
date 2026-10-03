# Mer Harness（メルハーネス）仕様ドラフト v0.1

> 2026-10-02 作成 / ステータス: ドラフト（未実装・未デプロイ）
> 非公式のOSSツール。メルカリ社とは無関係。§0 の確定事項が以下の記述より優先。メルカリAPIは使わない（後述）。

## 0. 確定事項（2026-10-02 聡承認）

- 名称: **メルハーネス / mer-harness**（表示 "Mer Harness"）。ロゴは「Harness」のみ、メルカリのマーク不使用。README に非公式・無関係を明記。
- GitHub: `sat0xshi/mer-harness`（public, MIT, README 英日）。秘密はコミットしない。
- URL: production `furima-harness.sat0xshi.com` / staging `furima-harness-stg.sat0xshi.com` / dev はローカル（2026-10-03 フリマハーネス改名で変更。旧 `mer-harness(-stg).sat0xshi.com` は新ホストへ 301）。**production デプロイは聡の「出して」待ち。**
- Cloudflare: **Workers Free のみ**。有料機能・上限なし従量課金は使わない。R2 は使わず、MVP の画像は **D1 に縮小JPEG（長辺≦1080px, ~200KB）を保存**＋端末保存（D1 Free は 5GB/上限停止）。必要になったら R2 を上限・削除付きで再検討。
- 白背景化: **ブラウザ内処理のみ**（Cloudflare Images は使わない）。
- AI補助: **最初から Workers AI 無料枠**（Gemma 4 Vision）。日次呼び出し上限をアプリ側でも設定、AI 無効でも完走。
- ログイン: **Cloudflare Access（Google ログイン, 許可は OWNER_EMAIL（secret）のみ）**。
- データ: **D1 が正**。PWA は静的シェルのみキャッシュ。
- **マーケットプレイス・アダプタ**: 手数料・発送方法・タイトル/説明の文字数上限・コピー形式・売り切れ検索URL/ヒントは `packages/core/platforms/<id>.ts` の小さな設定/アダプタに隔離（`PlatformConfig` 型）。MVP は `mercari` のみ同梱。後で Yahoo!オークション / Yahoo!フリマ / ラクマを追加可能に。item は `platform` 列を持つ。
- **どのマーケットプレイスのサイトにもアクセスしない**（スクレイピング・非公式API・自動投稿なし）。検索URLは生成して本人が開くだけ。README に明記。
- **将来（MVP外）: 海外対応**（中国向けマーケットプレイス等）。UI 文字列は i18n 対応の形で持つ（ja 先行、en/zh は後）。通貨・ロケールは `PlatformConfig` に持たせる。今は作らない。
- MVP 優先: 出品のみ使えるスライス（撮影→正方形→質問→出品文→価格3案→コピー→在庫ボード＋売れ残り棚→XP/レベル/ストリーク＋ピコーン, reduced-motion）。発送ナビは後。

## 1. ゴール

- 出品の二大ハードル **「登録（出品）」と「発送」** を、手順の分解＋ゲーム化（ピコーン！）で軽くする。
- スマホからどこでも使える個人用PWA（まず1ユーザー＝聡）。Cloudflare 上でホスト。
- GitHub で最初から公開（MIT、README 英日）。秘密情報はリポジトリに置かない。
- **やらないこと**: メルカリへの自動出品・自動取得（スクレイピング）。最後のひと押しは本人がメルカリアプリで行う。

### 成功の定義（MVP）
- ドッグフード品（Pixel 10 Pro Fold / HoloLens 2 / GORUCK ×3）の5点を、本アプリ経由で **1点あたり10分以内** に出品できる。
- 売れた→発送完了まで、チェックリストに沿って迷わず進める。
- 無料枠のみで運用（従量課金ゼロ）。

## 2. 既存サービスとの差分（調査要約）

| サービス | 内容 | 本アプリとの違い |
|---|---|---|
| メルカリ「AI出品サポート」 https://help.jp.mercari.com/guide/articles/1867/ | 写真＋カテゴリ選択でタイトル・説明・状態・価格を自動入力（全ユーザー対象, 2025〜） | 一発生成型。**質問で情報を詰める・ゲーム化・在庫棚・発送ナビは無い** |
| メルカリ 撮影時の背景ぼかし（Photoroom技術） https://prtimes.jp/main/html/rd/p/000000018.000126737.html | 撮影画面で背景ぼかし | 正方形トリミング/白背景化までは手動 |
| Photoroom / remove.bg 等 https://www.photoroom.com/ja/tools/background-remover | 背景削除・白背景 | 画像のみ。出品フローと分断 |
| Vendoo / List Perfectly / Crosslist https://www.underpriced.app/tools/crosslisting-platforms-comparison | 米国向けクロスリスティング（$15〜99/月） | **米国Mercari向け**、日本のメルカリ非対応、ゲーム要素なし |
| フリマアシスト（Chrome拡張） https://chromewebstore.google.com/detail/jcbljdgnpcckiamdgmnfhijgkkaogmgg | Web版メルカリの再出品・定型文・日時表示 | PC Web拡張。規約グレー寄り |
| オークファン https://aucfan.com/ | メルカリ過去取引の相場検索（2024〜公式データ連携） | 相場調査のみ（詳細は有料プランあり） |
| Tagara https://get.tagara.app/ | 断捨離のゲーム化（XP・ストリーク） | 出品・発送の実務支援は無い |

**結論: 「日本のメルカリ向け・質問で出品文を育てる・出品〜発送〜売れ残りまでをゲーム化」した同等品は見当たらない。** 個々の機能（AI生成・背景削除・相場検索）は既存にあるので、本アプリは「つなぐ＋やる気を出す」ハーネスに徹する。

## 3. メルカリAPIの現実

- **公式に一般個人が使える出品/検索APIは無い。**
  - Mercari Shops API（GraphQL）: ショップ（事業者）専用、契約時に発行される `API_CLIENT_NAME` が必須。 https://api.mercari-shops.com/docs/index.html
  - フリマ本体の「Open API」はパートナー（越境代理購入事業者等）向けの契約制。非公式PHP SDKが存在（client_id/secret要） https://sanmai.github.io/mercari-php-sdk/ → 個人では入手不可。
- **規約**: 「弊社が提供するインターフェイスとは別の手法を用いてサービスにアクセスすること」「リバースエンジニアリング」「事前の書面許可なく商業目的でサービス外利用」は禁止 https://help.jp.mercari.com/guide/articles/900/ / 利用規約 https://static.jp.mercari.com/tos 。米国版も robot/scraper 明示禁止 https://www.mercari.com/us/help_center/topics/account/policies/prohibited-conduct/ 。
  - 非公式クライアント（mercapi 等）でのスクレイピングは**アカウント停止リスク**。OSSとして配布するなら尚更NG。
- **現実解**
  - 価格: ①検索URL生成（`https://jp.mercari.com/search?keyword=…&status=sold_out`）→本人がアプリで見る ②**売り切れ一覧のスクショを貼る→Vision LLMで価格抽出→中央値** ③価格の手入力/コピペ ④オークファンへのリンク。
  - リアクション（いいね/コメント/オファー）: アプリ内表示・返信は**不可（Later扱い）**。代替として「いいね数・コメント有無」を手入力→値下げ判断ヒントに使う。将来案: メルカリ通知メールを Cloudflare Email Routing → Email Worker で受けて「購入されました」で自動SOLD化（自分宛メールの処理なので規約リスク低、要検証）。
  - 出品: 「メルカリにコピー」ボタン（タイトル/説明/価格を個別コピー）＋加工済み画像を端末に保存→メルカリアプリで貼る。

## 4. スコープ

### MVP（v0.1）
1. 撮影/選択 → 自動トリミング（1:1・被写体中央・余白調整・明るさ補正）→ 任意で白背景化
2. カテゴリ別質問カード（スマホ/ガジェット/衣類/その他）→ 出品文がリアルタイムに組み上がる
3. 相場メモ（スクショ or 手入力）→ 価格3案（即売れ / 標準 / 強気）＋手取り計算（手数料10%・送料）
4. コピー出品画面（タイトル40字・説明1000字以内チェック、NGワード注意）
5. 在庫ボード: 下書き → 出品中 → 取引中 → 発送待ち → 完了 / 売れ残り棚
6. 発送ナビ: サイズ判定（3辺/厚さ/重さ入力）→ 最安メルカリ便提案 → 梱包チェックリスト
7. ゲーム: XP・レベル・ストリーク・コンボ・バッジ・売上カウンター、ピコーン演出（音/紙吹雪/振動）
8. 3環境（dev/staging/prod）、Cloudflare Access による本人限定ログイン

### Later
- 白背景化の品質向上（複数カット一括、影付け）、写真枚数ガイド（傷アップ等）
- 通知メール連携による自動SOLD化／取引メッセージ定型文
- 売れ残り自動提案（N日経過→値下げ幅提案）、再出品テンプレ
- 多ユーザー化（OSS利用者向けセルフホスト手順）、ラクマ/Yahoo!フリマ向けコピー形式
- いいね/コメントのアプリ内表示（公式手段が出たら）

## 5. 画面とフロー

```
[ホーム] レベル/XPバー・ストリーク・売上金・今日のクエスト・「＋出品」大ボタン
   │
   ├─▶ [撮影] カメラ/アルバム（複数枚） → [トリミング] 自動1:1→手で微調整→白背景ON/OFF
   │        → [質問カード] 1問ずつ（スワイプ/タップ回答）。画面下に出品文プレビューが育つ
   │        → [価格] 相場スクショ貼付/手入力 → 3案＋手取り表示 → 決定
   │        → [コピー出品] 画像保存・タイトル/説明/価格コピー → 「メルカリで出品した！」→ ピコーン(出品)
   │
   ├─▶ [在庫ボード] ステータス別タブ。カードを長押しで状態変更
   │        出品中 →「売れた！」→ ピコーン(大) → [発送ナビ]
   │        出品中 →「売れ残り棚へ」（N日経過で提案）
   │
   ├─▶ [発送ナビ] サイズ入力 → 便提案（らくらく/ゆうゆう）→ 梱包チェック → 「発送した！」→ ピコーン → 完了
   │
   └─▶ [実績] レベル・バッジ・累計売上・グラフ / [設定] 音量・振動・手数料率・発送元
```

### 質問テンプレート例（MVPで同梱）
- **スマホ/タブレット**: 型番・容量・色 / SIMフリーか / ネットワーク利用制限 / 残債 / バッテリー状態 / 画面・ヒンジ傷 / 初期化・アカウント解除済 / 付属品（箱・ケーブル・ケース） / 購入時期・保証
- **ガジェット（HoloLens 2 等）**: 型番・エディション / 動作確認内容 / レンズ・バイザー傷 / 付属品（ケース・充電器・ブリッジ） / 使用頻度 / 初期化済
- **衣類（GORUCK 等）**: ブランド・品名・サイズ表記 / 実寸（着丈・身幅・肩幅・袖丈） / 素材 / 着用回数 / 毛玉・ほつれ・汚れ / 保管環境（喫煙・ペット）
- 共通: 状態ランク（メルカリの6段階）/ 傷の有無と写真 / 発送方法 / 値下げ交渉可否

出品文はテンプレート（決定的）で組み立て、LLMは「タイトル案の言い換え」「写真から型番・傷候補の推測」の補助に限定（無料枠超過時もアプリは動く）。

## 6. データモデル（D1 / SQLite）

```
items        id, title, category, status[draft|listed|trading|to_ship|done|shelf],
             brand, model, condition, answers_json, description, price, price_low, price_high,
             listed_at, sold_at, shipped_at, shelf_at, sold_price, ship_method, ship_cost,
             likes, notes, created_at, updated_at
photos       id, item_id, r2_key_original, r2_key_processed, position, is_cover, width, height
comps        id, item_id, source[manual|screenshot|url], price, condition, sold(bool), url, note, created_at
shipments    id, item_id, length_cm, width_cm, height_cm, thickness_cm, weight_g, method, fee, checklist_json
events       id, type[item_created|listed|sold|shipped|shelved|relisted|badge|levelup], item_id, xp, meta_json, created_at
achievements id(badge_key), unlocked_at
settings     key, value   -- 手数料率, 音量, 振動, 発送元 等
```
- XP/レベル/ストリークは `events` から算出（再計算可能＝ルール変更に強い）。
- 画像は R2（非公開バケット）。端末側で EXIF（GPS含む）を削除してからアップロード。photos に `state[pending|ready]` を持ち孤児を掃除。
- items は `shipped_at` と `completed_at`（取引完了＝売上確定）を分ける（Codexレビュー指摘）。

## 7. ゲームメカニクス（**正は DESIGN.md §5〜8**）

- XP（DESIGN準拠）: 写真+3/枚、回答+5、出品文完成+20、価格決定+10、**出品+50 / 売れた+80 / 発送+60**、再出品+30、初回ボーナス+100。1品通しで約300〜350XP。
- レベル: `need(L)=80+40L`（Lv.5≈720XP, Lv.10≈2,520XP）。ストリーク: 1日1アクション、日付区切りは午前4時、7日ごとに「おやすみ券」。コンボ: 20分以内の連続出品で×1.2/×1.5/×2.0（出品文完成品のみ）。
- 演出は `celebrate(event)` の1入口に集約、優先度キュー＋頻度制限、reduced-motion 代替、初回はサウンドOFF。
- 罪悪感を煽らない: XP減点なし、ストリーク途切れでもベスト記録保持、通知は初期オフ。
- XP/レベルは `events`（ルール版 `rule_version` 付き）から再計算可能にする。状態遷移＋イベント追加は冪等キーで二重加算防止。

## 8. 画像パイプライン（無料枠前提）

1. **ブラウザ内（無料・既定）**: Canvas/OffscreenCanvas で長辺2048px→1:1センタークロップ（メルカリは正方形表示）、自動レベル補正・ホワイトバランス、EXIF削除、WebP/JPEG 出力。手動で位置・ズーム調整可。
2. **白背景化（任意）**: **Cloudflare Images の `segment=foreground`**（BiRefNet、Free プランで月5,000ユニーク変換まで無料。超過時はエラーになるだけで課金なし） https://developers.cloudflare.com/images/optimization/features/ / https://developers.cloudflare.com/images/pricing/ 。`background=white` で白塗り、`trim`/`gravity` と組合せ。
   - 代替: ブラウザ内モデル（transformers.js + BiRefNet 等）。※ `@imgly/background-removal` は AGPL のため MIT リポジトリでは避ける。
   - 注意: 中古品は「実物感」も大事。1枚目のみ白背景、2枚目以降と傷アップは元写真推奨。
3. **テキスト補助（任意）**: Workers AI `@cf/google/gemma-4-26b-a4b-it`（Vision対応、Workers Free でも利用可）。無料枠 10,000 Neurons/日、**Workers Free プランなら超過時は止まるだけで課金されない** https://developers.cloudflare.com/workers-ai/platform/pricing/ 。用途: 写真→型番/色/傷候補、相場スクショ→価格抽出、タイトル言い換え。1日の呼び出し上限をアプリ側でも設定。

## 9. アーキテクチャ（Cloudflare）

- **Workers（Static Assets 付き）1本**: SPA（Vite + React + TypeScript, PWA）＋ API（Hono）。Pages ではなく Workers 推奨（Cloudflare の現行推奨構成）。
- **D1**: メタデータ。**R2**: 画像。**Images**: 変換/背景削除。**Workers AI**: 任意。
- **環境**（wrangler `env`、リソースは全て別）

| 環境 | URL（案） | D1 / R2 | 認証 |
|---|---|---|---|
| development | `wrangler dev`（ローカル, Miniflare） | ローカルD1 / ローカルR2 | なし（`DEV_AUTH_BYPASS=1`） |
| staging | `furima-harness-stg.sat0xshi.com` | `mer-harness-stg` / `mer-harness-stg-images` | Cloudflare Access |
| production | `furima-harness.sat0xshi.com` | `mer-harness-prod` / `mer-harness-prod-images` | Cloudflare Access |

- デプロイ（後日・要承認）: GitHub Actions — PR で test/lint/型チェック、`main` マージで staging、タグ `v*` で production。`CLOUDFLARE_API_TOKEN` は GitHub Secrets のみ。
- 画像配信: **同一オリジンの Worker 経由に統一**（Access JWT検証 → R2 binding → Images binding で変換 → 結果をR2に保存して再利用）。R2 公開ドメイン/`r2.dev` は無効。`workers_dev:false`・`preview_urls:false` で Access 迂回経路を閉じる。具体的な wrangler.jsonc 案は ARCH_REVIEW.md §2。
- 無料枠の注意: **R2 は無料枠超過で従量課金になる（上限停止ではない）**。10GB-month/月等の枠内に収まるよう枚数・サイズ上限と古い画像の削除を実装。Workers/Images/Workers AI(Free) は超過で停止のみ。
- データ置き場の論点: DESIGN.md は IndexedDB ローカルファースト＋Workersは薄いバックアップ案、本SPECは D1 正。→ MVPは **D1 正＋PWAは静的シェルのみキャッシュ** を推奨（未決事項9）。

## 10. 認証

- **Cloudflare Access（Zero Trust Free, 50ユーザーまで無料）** を staging/prod の前段に置き、許可メール = 聡のみ（Google ログイン or メールOTP）。アプリ側は `Cf-Access-Jwt-Assertion` を検証し `OWNER_EMAIL` と一致確認。
- アプリ内にパスワード実装なし。OSS 利用者は自分の Access ポリシーを設定（README に手順）。

## 11. OSS リポジトリ構成（案: `sat0xshi/mer-harness`）

```
/
├─ apps/web/            # Vite + React PWA（画面・演出・Canvas画像処理）
├─ apps/worker/         # Hono API, D1/R2/Images/AI バインディング
├─ packages/core/       # 型, 質問テンプレ, 出品文ビルダー, XPルール, 送料表, 価格計算（純関数・テスト厚め）
├─ migrations/          # D1 SQL
├─ docs/                # SPEC.md, DESIGN.md, ARCHITECTURE.md, スクショ
├─ wrangler.jsonc       # env.staging / env.production（IDのみ, 秘密なし）
├─ .dev.vars.example    # ローカル用サンプル（.dev.vars は gitignore）
├─ .github/workflows/   # ci.yml, deploy.yml（後日）
├─ README.md / README.ja.md / LICENSE(MIT) / SECURITY.md / CONTRIBUTING.md
```
- pnpm workspaces、Vitest、Playwright（スマホ幅のE2E 1本）、Biome。
- 免責: 「メルカリ公式ではない」「メルカリの商標・ロゴを使わない」「自動アクセスはしない」を README に明記。名称に「メルカリ」を含む点は商標的に要判断（下記）。

## 12. プライバシー / セキュリティ

- 画像の EXIF/GPS を端末側で削除。IMEI・シリアル・伝票・住所が写っていたら警告（Vision任意 + 撮影ガイド）。
- 購入者の個人情報は保存しない（メルカリ便は匿名配送前提）。
- R2 非公開、Access 必須。ログに画像や説明文を出さない。
- リポジトリに秘密なし（gitleaks を CI に）。サンプルデータは架空。

## 13. 発送ナビ用データ（packages/core に表で同梱、2026-10 時点・要定期確認）

- らくらくメルカリ便: ネコポス210円（A4・厚3cm・1kg）/ 宅急便コンパクト450円＋専用箱70円 / 宅急便60〜200サイズ 750〜2,500円 https://jp-news.mercari.com/contents/1986
- ゆうゆうメルカリ便: ゆうパケットポストmini 160円＋封筒20円 / ゆうパケット230円 / ゆうパケットポスト215円＋箱65円 / ゆうパケットプラス455円＋箱65円 / ゆうパック60〜170サイズ 750〜1,900円 https://jp-news.mercari.com/contents/1974
- ドッグフード品の目安: Pixel 10 Pro Fold（箱付）→ 宅急便コンパクト or 60サイズ / HoloLens 2（元箱）→ 80〜100サイズ / GORUCK 衣類 → ネコポス or ゆうパケットポスト（厚み次第）・厚手は宅急便コンパクト。高額品は匿名・補償ありのメルカリ便必須、梱包前に動画/写真記録。

## 14. 未決事項（聡に確認）

1. **名前**: 「Mer Harness」はメルカリの商標を含む。OSS公開名をこのままにするか、別名（例: Furima Harness / Pikon / 出品ハーネス）＋「for Mercari」表記にするか。
2. **サブドメイン**: `mer-harness.sat0xshi.com` / `mer-harness-stg.sat0xshi.com` でOK？
3. **Cloudflare プラン**: Workers は Free のまま（従量課金ゼロ・上限で停止）でOK？ もし既に Workers Paid なら AI 呼び出し上限をアプリ側で厳しめに。
4. **白背景化**: Cloudflare Images（無料5,000/月）で行く？ ブラウザ内処理のみで始める？
5. **LLM補助**: MVPから Workers AI（Gemma 4 Vision）を入れる？ テンプレのみで始める？
6. **ログイン方式**: Cloudflare Access の Google ログイン / メールOTP どちら？ 許可メールは？
7. **GitHub**: `sat0xshi` アカウント/組織名、リポジトリ名。ライセンス MIT で確定？
8. 手数料率 10%（設定で変更可）・発送元地域の既定値。
9. データ: D1 正（推奨）か、IndexedDB ローカルファースト（オフライン強いが同期が複雑）か。
10. ブランド表記: DESIGN.md はロゴを「Harness」（インディゴ＋ゴールド、ストラップ/バックル/縫い目モチーフ）とし「メルカリ」はロゴに入れない方針。これでOK？
