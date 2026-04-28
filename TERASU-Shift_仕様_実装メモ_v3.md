# TERASU-Shift 仕様・実装メモ

最終更新: 2026-04-29
バージョン: v2.1（UI改修・レスポンシブ対応・バグ修正・デザイン刷新後）

---

## プロジェクト概要

| 項目 | 内容 |
|---|---|
| アプリ名 | TERASU-Shift |
| 目的 | バー・ナイトクラブ複数店舗のスタッフ希望シフト収集・シフト作成・公開 |
| スタック | Next.js 16 (App Router) / TypeScript / Tailwind CSS / Supabase (PostgreSQL) |
| 認証 | 独自実装（Supabase Auth不使用）。staffs.staff_email + bcryptjs |
| セッション | jose (JWT HS256) / httpOnly cookie（terasu.session） |
| デプロイ | Vercel + Supabase |
| デバイス | シフト入力=スマホ / シフト作成・設定=PC/タブレット/スマホ（レスポンシブ対応済み） |

---

## 環境変数

| 変数名 | 用途 | 備考 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | SupabaseプロジェクトURL | 公開可 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon キー | 公開可 |
| `SUPABASE_SERVICE_ROLE_KEY` | RLSバイパス用 | サーバーサイド専用・絶対に公開しない |
| `AUTH_SECRET` | JWT署名用 | 32文字以上・サーバーサイド専用 |

---

## ロール定義（v2更新）

| role | できること | できないこと |
|---|---|---|
| `general` | 希望シフト提出・確定シフト閲覧（published分のみ・閲覧専用） | シフト作成・設定・CSV出力・ガント編集 |
| `leader` | 全機能（シフト作成・編集・公開・設定・CSV出力・希望シフト提出） | - |

### 重要な仕様（v2変更点）

- **全ロールが `/schedule` にアクセス可能**
  - `general` は閲覧専用モード（ガント・公開ボタン・CSV・セルクリック・希望↔シフトトグル非表示）
  - `general` は常に「シフト」表示固定
- **全ロールが `/request` にアクセス可能**
  - leader もシフト提出できる
- `/settings` は `leader` のみ（middleware で general を `/request` にリダイレクト）
- `display_status='hidden'` のスタッフも **ログインは可能**
  - シフトグリッドへの表示は `display_status='visible'` のみ
- `leave_date` が設定済みのスタッフはログイン不可・シフト非表示

---

## DB構成

### ⚠️ 絶対変更禁止の既存テーブル

```
companies / stores / staffs / memberships / shifts
attendances / clock_in_reports / clock_out_reports
clock_in_check_items / clock_out_check_items
clock_in_check_answers / clock_out_check_answers
tasks / task_routines / task_instances / task_assignees
trigger_task_templates / announcements / thanks_points
budgets / sales / actual_business_hours
store_settings / store_business_hours / business_time_categories / holidays
```

### 既存テーブルへの追加済みカラム（参照のみ）

```sql
shifts.shift_pattern_id     uuid  NULL  FK → shift_patterns
holidays.is_auto_imported   boolean  DEFAULT false
holidays.imported_at        timestamptz  NULL
```

### 新規追加テーブル（RLS適用済み）

#### shift_patterns（シフトパターンマスタ）
```
shift_pattern_id  uuid     PK
store_id          uuid     FK → stores
pattern_name      text     UNIQUE per store
start_minutes     integer  0=00:00 / 600=10:00 / 1320=22:00 / 1500=25:00
end_minutes       integer  end > start（最大2880=48:00）
display_order     integer  DEFAULT 0
is_active         boolean  DEFAULT true（削除は論理削除のみ）
```

#### shift_settings（シフト設定）1店舗1レコード
```
store_id              uuid     PK FK → stores
gantt_start_minutes   integer  DEFAULT 1080（18:00）
gantt_end_minutes     integer  DEFAULT 1740（29:00=翌5:00）
shift_cycle           text     weekly / biweekly / semimonthly / monthly
week_start_day        text     mon / sun
deadline_type         text     days_before / weeks_before / months_before
deadline_value        integer  DEFAULT 7
csv_format_type       text     NULL=デフォルト
updated_at            timestamptz
```

デフォルト値（未登録店舗は自動INSERT）:
```typescript
{
  gantt_start_minutes: 1080,
  gantt_end_minutes: 1740,
  shift_cycle: 'semimonthly',
  week_start_day: 'mon',
  deadline_type: 'days_before',
  deadline_value: 7,
  csv_format_type: null,
}
```

#### shift_requests（希望シフト）
```
shift_request_id      uuid        PK
store_id              uuid        FK → stores
staff_id              uuid        FK → staffs
work_date             date
target_month          date        月初日（例: 2026-05-01）
period_type           text        first_half / second_half / full
request_type          text        pattern / free / off / custom
shift_pattern_id      uuid        NULL（request_type=patternの場合）
custom_start_minutes  integer     NULL（request_type=customの場合）
custom_end_minutes    integer     NULL（request_type=customの場合）
submitted_at          timestamptz DEFAULT now()
UNIQUE(store_id, staff_id, work_date) → upsertで上書き運用
```

週次・隔週の `period_type` は `full` で保存し、日付範囲で期間を区別する。

#### shift_publish_statuses（シフト公開管理）
```
publish_status_id       uuid        PK
store_id                uuid        FK → stores
period_start            date
period_end              date
status                  text        draft / published
published_at            timestamptz NULL（draft中はNULL）
published_by_staff_id   uuid        NULL FK → staffs
created_at              timestamptz DEFAULT now()
UNIQUE(store_id, period_start, period_end)
CHECK: published時はpublished_at・published_by必須
```

---

## 時刻の扱い（重要）

### なぜ integer（分数）を採用したか
- `time` 型: 23:59:59 までしか扱えず、バーの深夜営業（25:00, 26:30等）を格納不可
- `timestamptz`: UTC保存のため JST 変換でバグリスクあり
- **integer（分数）**: タイムゾーン変換が一切発生しない

### 変換ルール
```
00:00 = 0 / 10:00 = 600 / 18:00 = 1080
22:00 = 1320 / 25:00 = 1500 / 26:30 = 1590
29:00（翌5:00）= 1740 / 最大 2880（48:00）
```

### 変換ユーティリティ（src/lib/time.ts）
```typescript
export function minutesToDisplay(minutes: number): string
export function displayToMinutes(display: string): number
export function minutesToPosition(minutes: number, ganttStart: number, ganttEnd: number): number
```

### 既存カラムの例外
`shifts.scheduled_start_at` / `scheduled_end_at` は既存の `timestamptz` のまま。
保存時は Asia/Tokyo で変換して格納する。

---

## Supabaseクライアントの使い分け

| クライアント | ファイル | 用途 | RLS |
|---|---|---|---|
| `createBrowserClient` | `src/lib/supabase/client.ts` | ブラウザ用 | 適用される |
| `createServerClient` | `src/lib/supabase/server.ts` | Server Component用 | 適用される |
| `createServiceClient` | `src/lib/supabase/service.ts` | サーバーサイド専用 | **バイパス** |

---

## セッション構造

```typescript
// terasu.session cookie（JWT HS256）
{
  staff_id: string
  staff_name: string
  memberships: Array<{
    store_id: string
    role: 'general' | 'leader'
  }>
  active_store_id: string | null
  iat: number
  exp: number  // 7日間
}
```

### セッション取得関数（v2追加）

```typescript
// src/lib/auth.ts
getSession()        // → { staff_id, staff_name, role, store_id }（店舗確定済みのみ）
getSessionPayload() // → JWTペイロード全体（memberships.length取得に使用）
```

`getSessionPayload()` は `memberships.length` から `storeCount` を算出するために追加。

---

## ファイル構成

```
src/
  app/
    (auth)/
      login/
        page.tsx              ログイン画面（Client Component）
        select-store/
          page.tsx            複数店舗選択画面（Server Component）
          SelectStoreForm.tsx  店舗選択フォーム（Client Component）
          SelectStoreStaffFooter.tsx  スタッフ名・ログアウト
        layout.tsx            useSearchParams用Suspense
    (shift)/
      request/
        page.tsx              希望シフト提出画面（Server Component）
        RequestShiftClient.tsx クライアント部分
        RequestDateRow.tsx    日付行コンポーネント
        actions.ts            upsertShiftRequests
      schedule/
        page.tsx              シフト作成画面（Server Component）
        ScheduleClient.tsx    クライアント部分（レスポンシブヘッダー）
        ScheduleGrid.tsx      カレンダーグリッド
        ScheduleGantt.tsx     ガントチャート
        actions.ts            upsertShiftTimes / publishSchedulePeriod / buildScheduleCsv
        types.ts              StaffRow / SchedulePageData
      settings/
        page.tsx              シフト設定画面（Server Component）
        SettingsPageClient.tsx クライアント部分
        actions.ts            createShiftPatternAction / updateShiftPatternAction等
    api/
      auth/
        login/route.ts        POST: ログイン
        logout/route.ts       POST: ログアウト
        select-store/route.ts POST: 店舗選択（cookie更新）
  lib/
    time.ts                   分数変換ユーティリティ
    auth.ts                   getSession() / getSessionPayload()（v2追加）
    session-token.ts          encodeSessionToken / decodeSessionToken
    logout-client.ts          logoutAndRedirectToLogin()
    shift-settings-ensure.ts  ensureShiftSettingsForStore()
    shift-request-periods.ts  期間・締切・週スライスロジック（v2追加関数あり）
    schedule-view-range.ts    表示幅ロジック（v2大幅更新）
    jst-shift-time.ts         JST変換（CSV・セル表示用）
    supabase/
      client.ts / server.ts / service.ts
  middleware.ts               認証・ルーティング制御
  types/
    database.ts               型定義
```

---

## 画面仕様（v2）

### ログイン画面（/login）
- ホワイト＋くすみスレート系デザイン
- `staff_email` + `password` で認証
- `leave_date` 設定済みはログイン不可
- `display_status='hidden'` でもログイン可能
- 1店舗所属 → role別ホームへ（全ロール `/schedule`）
- 複数店舗所属 → `/login/select-store`

### 店舗選択画面（/login/select-store）
- ホワイト＋くすみスレート系デザイン
- **ログイン済みでも `active_store_id` があってもアクセス可能**（店舗切り替えのため）
- middleware の即リダイレクト条件を削除済み
- ページ側の即リダイレクト条件も削除済み
- 店舗ボタンタップ → `/api/auth/select-store` で cookie 更新 → `/schedule`

### 希望シフト提出画面（/request）スマホ最適化
- **全ロール（general・leader）アクセス可能**
- 折りたたみ式ヘッダー（sticky top-0）
  - 折りたたみ時: 月・期間の要約＋締切1行
  - 展開時: 締切・月切替・期間コントロール
- ヘッダー右側: 店舗切り替え（storeCount >= 2のみ）・シフト表へ・ログアウト
- 今月・来月トグル: 締切を過ぎた月は disabled
- 期間トグル（前半・後半等）: 締切を過ぎた期間は disabled
- `formLocked`: 現在期間の締切済みまたは当月全締切済みで日付行・送信ボタン無効
- 全期間締切済みの場合: 「現在提出できる期間がありません」メッセージ表示
- ページ全体スクロール（独自スクロールコンテナなし）
- デザイン: ホワイト＋くすみスレート系

### シフト作成画面（/schedule）レスポンシブ対応済み
- **全ロール（general・leader）アクセス可能**
- ヘッダー構成:
  - **PC（lg以上）**: 1段全展開。左に店舗名・担当者、中央にコントロール群、右にナビボタン全展開
  - **スマホ・タブレット（lg未満）**: 左端☰メニュー＋月移動・表示幅・希望/シフト。☰内にナビ・設定・CSV・ログアウト
  - 店舗切り替えボタン: PC は常時表示（storeCount >= 2のみ）、スマホは☰内
- **閲覧専用モード（general）**:
  - 希望↔シフトトグル非表示（シフト表示固定）
  - 公開ボタン・CSVエクスポート・設定リンク非表示
  - セルクリック無効・ガントチャート非表示
  - 月移動・表示幅・店舗切り替え・ログアウト・希望シフト提出ボタンは表示
- **leader 専用**:
  - 希望↔シフトトグル
  - 公開ステータス・公開ボタン
  - CSV（PCは常時・スマホは☰内）
  - ガントチャート（セルクリックで表示）
- 未提出スタッフ: 名前セルを `bg-amber-50 text-amber-800 border-l-2 border-l-amber-400` で表示
- 今日の日付列: `bg-slate-700 text-white font-bold` でハイライト
- 今日列自動スクロール: `scrollRef`（overflow-x-auto の div）に対して `scrollLeft` を直接操作
  - `todayColIndex = columnDates.indexOf(todayStr)` で列インデックスを取得
  - `STAFF_COL_WIDTH=128px`・`DATE_COL_WIDTH=44px` で left 位置を計算
  - コンテナ幅の中央に今日列が来るよう `scrollLeft` を設定
- グリッドレスポンシブ:
  - `tableLayout: 'fixed'` + `w-full` でPC広幅時に列が均等拡張
  - `overflow-x-auto` > `min-w-fit` ラッパー > `table` の構造
  - 狭い幅では `minWidth`（`120 + columnDates.length * 44`px）で横スクロール
- sticky セルの z-index:
  - スマホ header: `z-50`（ドロワーがグリッドより前面に出るために必須）
  - ドロワーオーバーレイ: `z-40`、ドロワー本体: `z-50`
  - thead スタッフ列 th: `z-30`・`top-0`・`willChange:transform`
  - thead 日付列 th: `z-20`・`top-0`・`willChange:transform`
  - tbody スタッフ列 td: `z-10`・`top-auto`・`willChange:transform`
  - ※ `willChange:transform` はスタッキングコンテキスト分断の回避に必要
- ガントチャート: 時間軸（正時ラベル）＋縦グリッド線（正時 `bg-zinc-100`・30分 `bg-zinc-50`）付き
- 表示幅: 1週間・2週間・半月・1か月
  - `?start=YYYY-MM-DD&view=weekly|biweekly|semimonthly|monthly`
  - `?ym=YYYY-MM` との後方互換あり
  - 表示幅変更時: monthly は月初基準、それ以外は今日基準
- デザイン: ホワイト＋くすみスレート系・ライトモード固定

### シフト設定画面（/settings）leaderのみ
- middleware で general は `/request` にリダイレクト
- シフトパターンCRUD（論理削除・is_active=false）
- ガントチャート表示時間設定
- シフトサイクル・週始まり・締切設定
- デザイン: ホワイト＋くすみスレート系

---

## middleware.ts の制御ロジック（v2）

```
未ログイン → /login
ログイン済み:
  active_store_id なし → /login/select-store（例外: /login/select-store 自体はそのまま通す）
  /settings → general は /request にリダイレクト
  /schedule → 全ロール通過（v2変更: general の /schedule 禁止を撤廃）
  /request  → 全ロール通過（v2変更: leader も /request にアクセス可能）
```

### 店舗切り替えフロー（v2修正済み）
```
1. ヘッダーの「店舗切替」ボタン → /login/select-store
2. /login/select-store: active_store_id があっても即リダイレクトしない（修正済み）
3. middleware: /login/select-store は active_store_id 確認後のリダイレクトを行わない（修正済み）
4. 店舗選択 → /api/auth/select-store で cookie 更新 → /schedule
```

---

## 主要ライブラリ・関数（v2追加分）

### src/lib/schedule-view-range.ts（v2大幅更新）

```typescript
type ScheduleViewKind = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'

type ViewRange = {
  dates: string[]       // 表示する 'YYYY-MM-DD' の配列
  prevStart: string     // 前へボタン用の開始日
  nextStart: string     // 次へボタン用の開始日
  viewLabel: string     // 例: '2026年4月' / '4/1〜4/14'
}

calcViewRange(startStr: string, view: ScheduleViewKind): ViewRange
buildSchedulePath(startYmd: string, view: ScheduleViewKind): string
parseScheduleViewKind(val: string): ScheduleViewKind
uniqueTargetMonthFirstsInRange(start: string, end: string): string[]
```

URLパラメータ:
- `?start=YYYY-MM-DD&view=weekly` （v2形式）
- `?ym=YYYY-MM` （後方互換・start なし時は月初を使用）

### src/lib/shift-request-periods.ts（v2追加関数）

```typescript
type PeriodDeadlineInfo = {
  sel: PeriodSel
  periodFirstYmd: string
  deadlineYmd: string
}

listPeriodsWithDeadlines(targetMonthFirst: string, settings: ShiftSetting): PeriodDeadlineInfo[]
monthHasAnyOpenPeriod(targetMonthFirst: string, settings: ShiftSetting, todayYmd: string): boolean
isDeadlineExpiredVsToday(deadlineYmd: string, todayYmd: string): boolean
periodSelEquals(a: PeriodSel, b: PeriodSel): boolean
```

---

## デザインシステム（v2.1）

### カラーパレット
```
ベース:     white / zinc-50 / zinc-100
ボーダー:   zinc-200 / zinc-300
テキスト:   zinc-900（メイン）/ zinc-500（サブ）/ zinc-400（キャプション）
アクセント: slate-600 / slate-700（プライマリ）
成功:       emerald-600（公開済み・保存成功）
警告:       amber-50 / amber-800（未提出スタッフ）
エラー:     rose-600（締切日・エラー）
今日:       slate-700（グリッドハイライト）
土曜:       sky-50 / sky-700
日祝:       rose-50 / rose-600
```

### 共通コンポーネントスタイル
```
プライマリボタン: bg-slate-700 text-white hover:bg-slate-800 rounded-md transition-colors
セカンダリボタン: border border-zinc-200 text-zinc-600 hover:bg-zinc-50 rounded-md transition-colors
input/select:    border border-zinc-200 rounded-md focus:ring-1 focus:ring-slate-400
カード:          bg-white rounded-lg border border-zinc-200 shadow-sm
ヘッダー:        bg-white/95 backdrop-blur-sm border-b border-zinc-100 shadow-sm sticky top-0
```

### ダークモード
- **ライトモード固定**（OSのダークモード設定は無視）
- `tailwind.config.ts` に `darkMode: 'class'` を設定済み
- `globals.css` に `@config "../../tailwind.config.ts"` を追加済み（Tailwind CSS v4対応）
- `dark:` クラスは `<html class="dark">` がある場合のみ効く（現状は付与しないため実質無効）

---

## シフト公開フロー

```
1. leaderがシフト作成画面でガントを編集
   → shifts テーブルにINSERT/UPDATE（draft状態・generalには非表示）

2. 「公開する」ボタン
   → shift_publish_statuses を upsert
      status: 'published'
      published_at: now()
      published_by_staff_id: session.staff_id

3. その瞬間からgeneralのRLSが通る
   → スタッフの確定シフト画面に表示される
```

---

## 既知の問題・今後の課題

| 項目 | 状態 | 備考 |
|---|---|---|
| 祝日自動取得バッチ | ⬜ 未実装 | 内閣府API → holidaysテーブル自動インポート |
| display_status='hidden'ログイン | ✅ 修正済み | |
| shift_settings未登録時の自動INSERT | ✅ 修正済み | |
| 店舗切り替えボタン動作しない | ✅ 修正済み | middleware と select-store ページの即リダイレクト条件を削除 |
| general の /schedule アクセス | ✅ 修正済み | 閲覧専用モードで対応 |
| 表示幅切替時の移動バグ | ✅ 修正済み | start パラメータ導入で解決 |
| 未提出バナーが邪魔 | ✅ 修正済み | 名前セル背景色で代替 |
| OS ダークモードで背景が真っ黒になる | ✅ 修正済み | tailwind.config `darkMode:'class'` + globals.css の `@media (prefers-color-scheme: dark)` 削除 |
| ガント: 保存前にバーがチラつく | ✅ 修正済み | `committed` state を追加し live 削除後も表示を維持 |
| ガント: 30分刻みのグリッド線なし | ✅ 修正済み | `halfHourTicks` を追加（正時 bg-zinc-100・30分 bg-zinc-50）|
| /schedule グリッド幅レスポンシブ | ✅ 修正済み | `tableLayout:fixed` + `min-w-fit` ラッパー + colgroup minWidth化 |
| /schedule 今日列自動スクロール | ✅ 修正済み | `todayRef` 廃止・`scrollRef` で `scrollLeft` 直接操作に変更 |
| /schedule 今日列ハイライト色が消える | ✅ 修正済み | th の固定 `bg-zinc-50` が `tone` と競合していたため削除 |
| スマホドロワーがグリッドに隠れる | ✅ 修正済み | スマホ header を `z-50` に変更 |
| スタッフ名 td が thead より前面に出る | ✅ 修正済み | sticky セルに `willChange:'transform'` を付与 |
| /request ヘッダー右上に無駄な空白 | ✅ 修正済み | `flex-col` → `flex-wrap items-center` に変更 |
| /request 週次期間 select が押しにくい | ✅ 修正済み | `w-full py-2.5 text-sm` に変更 |
| /request パターン増加時にボタンがはみ出す | ✅ 修正済み | `flex-wrap` + `whitespace-nowrap` を追加 |
| Android で翻訳ポップアップが毎回出る | ✅ 修正済み | `html lang="en"` → `lang="ja"` に変更 |

---

## CSVエクスポート

```
#従業員コード,勤務日,パターンコード,出勤予定,退勤予定,出勤所属コード
```
- `#従業員コード` = `staffs.staff_number`
- `パターンコード` = `shifts.shift_pattern_name`
- `出勤予定/退勤予定` = JST HH:mm形式
- 最終行は改行で終了

---

## よく使うSQL

```sql
-- 店舗一覧
SELECT store_id, store_name FROM stores;

-- スタッフの所属確認
SELECT m.store_id, s.store_name, m.role, m.display_status
FROM memberships m
JOIN stores s ON s.store_id = m.store_id
WHERE m.staff_id = 'スタッフID';

-- shift_settings確認
SELECT * FROM shift_settings;

-- 希望シフト確認
SELECT * FROM shift_requests
WHERE store_id = '店舗ID'
ORDER BY work_date;

-- 公開状態確認
SELECT * FROM shift_publish_statuses
WHERE store_id = '店舗ID'
ORDER BY period_start;
```
