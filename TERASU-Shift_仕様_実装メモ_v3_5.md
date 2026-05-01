# TERASU-Shift 仕様・実装メモ

最終更新: 2026-05-01
バージョン: v3.5（メモ欄追加・公開取消機能・ガントUI改善）

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
| デバイス | 希望シフト入力=スマホ / シフト作成・設定=PC/タブレット/スマホ（レスポンシブ対応済み） |
| PWA | manifest.json・アイコン設定済み（ホーム追加対応） |

---

## 環境変数

| 変数名 | 用途 | 備考 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | SupabaseプロジェクトURL | 公開可 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon キー | 公開可 |
| `SUPABASE_SERVICE_ROLE_KEY` | RLSバイパス用 | サーバーサイド専用・絶対に公開しない |
| `AUTH_SECRET` | JWT署名用 | 32文字以上・サーバーサイド専用 |

---

## ロール定義（v3.3更新）

| role | できること | できないこと |
|---|---|---|
| `general` | 希望シフト提出・確定シフト閲覧（published分のみ・閲覧専用） | シフト作成・設定・CSV出力・ガント編集・希望シフト編集 |
| `leader` | 全機能（シフト作成・編集・削除・公開・公開取消・設定・CSV出力・希望シフト提出・他スタッフ希望シフト編集） | - |

### 重要な仕様

- **全ロールが `/schedule` にアクセス可能**
  - `general` は閲覧専用モード（ガント・公開ボタン・CSV・セルクリック・希望↔シフトトグル非表示）
  - `general` は常に「シフト」表示固定
  - `general` は現在の表示範囲が当月より前に移動不可（v3.3追加）
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

### 新規追加テーブル（読み書きOK）

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
store_id                    uuid     PK FK → stores
gantt_start_minutes         integer  DEFAULT 1080（18:00）
gantt_end_minutes           integer  DEFAULT 1740（29:00=翌5:00）
shift_cycle                 text     weekly / biweekly / semimonthly / monthly
week_start_day              text     mon / sun
deadline_type               text     days_before / weeks_before / months_before
deadline_value              integer  DEFAULT 7
csv_format_type             text     NULL=デフォルト
show_requests_to_general    boolean  DEFAULT true（v3.3追加）
attendance_location_code    text     NULL（v3.4追加・CSV出勤所属コード用）
updated_at                  timestamptz
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
  show_requests_to_general: true,
  attendance_location_code: null,
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
`/schedule` からleaderが編集した場合も `period_type: 'full'` で保存（v3.3）。

#### shift_publish_statuses（シフト公開管理）
```
publish_status_id       uuid        PK
store_id                uuid        FK → stores
period_start            date        常に月初日（v3.4修正）
period_end              date        常に月末日（v3.4修正）
status                  text        draft / published
published_at            timestamptz NULL（draft中はNULL）
published_by_staff_id   uuid        NULL FK → staffs
created_at              timestamptz DEFAULT now()
UNIQUE(store_id, period_start, period_end)
CHECK: published時はpublished_at・published_by必須
```

#### schedule_memos（日別メモ）v3.5追加
```
memo_id     uuid        PK DEFAULT gen_random_uuid()
store_id    uuid        FK → stores ON DELETE CASCADE
memo_date   date
memo_text   text        DEFAULT ''
updated_at  timestamptz DEFAULT now()
UNIQUE(store_id, memo_date)
INDEX(store_id, memo_date)
```

作成SQL:
```sql
create table schedule_memos (
  memo_id       uuid primary key default gen_random_uuid(),
  store_id      uuid not null references stores(store_id) on delete cascade,
  memo_date     date not null,
  memo_text     text not null default '',
  updated_at    timestamptz not null default now(),
  unique(store_id, memo_date)
);
create index on schedule_memos(store_id, memo_date);
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
export function minutesToShort(minutes: number): string  // 表示専用・保存・計算には使わない
```

### 既存カラムの例外
`shifts.scheduled_start_at` / `scheduled_end_at` は既存の `timestamptz` のまま。
保存時は Asia/Tokyo で変換して格納する。
読み取り時は `isoToMinutesFromWorkDateMidnight(iso, workDate)`（`@/lib/jst-shift-time`）を使う。

---

## Supabaseクライアントの使い分け

| クライアント | ファイル | 用途 | RLS |
|---|---|---|---|
| `createBrowserClient` | `src/lib/supabase/client.ts` | ブラウザ用 | 適用される |
| `createServerClient` | `src/lib/supabase/server.ts` | Server Component用 | 適用される |
| `createServiceClient` | `src/lib/supabase/service.ts` | サーバーサイド専用 | **バイパス** |

### ⚠️ 重要：全 Server Actions・全 Server Component は `createServiceClient()` を使う

既存テーブルは RLS ポリシーなし・anon から読めない。新規テーブルも
RLS が有効なため、Server Actions で `createServerClient` や `createBrowserClient` を使うと
データが取得できない・INSERT が拒否される。

### ⚠️ 公開制御はアプリ側ロジックで実装（v3.4修正）

`shifts` テーブルの RLS は service_role でバイパスされるため実質機能しない。
`schedule/page.tsx` のサーバー側で role に応じて手動フィルタリングする。

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

### セッション取得関数

```typescript
// src/lib/auth.ts
getSession()        // → { staff_id, staff_name, role, store_id }（店舗確定済みのみ）
getSessionPayload() // → JWTペイロード全体（memberships.length取得に使用）
```

---

## ファイル構成

```
src/
  app/
    (auth)/
      login/
        page.tsx
        select-store/
          page.tsx
          SelectStoreForm.tsx
          SelectStoreStaffFooter.tsx
        layout.tsx
    (shift)/
      request/
        page.tsx
        RequestShiftClient.tsx
        RequestDateRow.tsx
        actions.ts            upsertShiftRequests
      schedule/
        page.tsx              schedule_memos取得追加（v3.5）
        ScheduleClient.tsx    公開取消ボタン追加（v3.5）
        ScheduleGrid.tsx      メモ行追加（v3.5）
        ScheduleGantt.tsx     ガントUIコンパクト化（v3.5）
        actions.ts            upsertScheduleMemoAction / unpublishSchedulePeriod 追加（v3.5）
        types.ts
      settings/
        page.tsx
        SettingsPageClient.tsx
        actions.ts
    api/
      auth/
        login/route.ts
        logout/route.ts
        select-store/route.ts
  lib/
    time.ts
    auth.ts
    session-token.ts
    logout-client.ts
    shift-settings-ensure.ts
    shift-request-periods.ts
    schedule-view-range.ts
    jst-shift-time.ts
    supabase/
      client.ts / server.ts / service.ts
  middleware.ts
  types/
    database.ts               ScheduleMemo型追加（v3.5）
  encoding-japanese.d.ts
public/
  manifest.json
  icons/
```

---

## 主要 Server Actions 一覧

### `src/app/(shift)/schedule/actions.ts`
```typescript
upsertShiftTimes(...)               // 確定シフト登録・更新（既存）
publishSchedulePeriod(...)          // シフト公開（v3.4修正）
unpublishSchedulePeriod(...)        // シフト公開取消（v3.5追加）
buildScheduleCsv(...)               // CSV生成（v3.4改修）
deleteShiftAction(shiftId)          // 確定シフト削除（v3.3追加）
upsertShiftRequestAction(data)      // 希望シフト登録・更新（v3.3追加）
deleteShiftRequestAction(data)      // 希望シフト削除（v3.3追加）
upsertScheduleMemoAction(data)      // 日別メモ保存（v3.5追加）
```

### `src/app/(shift)/settings/actions.ts`
```typescript
createShiftPatternAction(...)       // パターン作成（既存）
updateShiftPatternAction(...)       // パターン更新（既存）
upsertShiftSettingsAction(...)      // 設定保存（v3.4更新）
updateShowRequestsToGeneralAction(storeId, value)  // 希望表示設定（v3.3追加）
```

### `src/app/(shift)/request/actions.ts`
```typescript
upsertShiftRequests(...)            // 希望シフト提出（既存）
```

---

## TypeScript 型定義

```typescript
export type ShiftPattern = {
  shift_pattern_id: string; store_id: string; pattern_name: string
  start_minutes: number; end_minutes: number; display_order: number; is_active: boolean
}

export type ShiftRequest = {
  shift_request_id: string; store_id: string; staff_id: string
  work_date: string; target_month: string; period_type: 'first_half' | 'second_half' | 'full'
  request_type: 'pattern' | 'free' | 'off' | 'custom'
  shift_pattern_id: string | null; custom_start_minutes: number | null
  custom_end_minutes: number | null; submitted_at: string
}

export type RequestSummary = {
  staff_id: string; work_date: string
  request_type: 'pattern' | 'free' | 'off' | 'custom'
  shift_pattern_id: string | null
  custom_start_minutes: number | null; custom_end_minutes: number | null
}

export type ShiftSetting = {
  store_id: string; gantt_start_minutes: number; gantt_end_minutes: number
  shift_cycle: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'
  week_start_day: 'mon' | 'sun'
  deadline_type: 'days_before' | 'weeks_before' | 'months_before'
  deadline_value: number; csv_format_type: string | null
  show_requests_to_general: boolean
  attendance_location_code: string | null
  updated_at: string
}

export type Shift = {
  shift_id: string; store_id: string; staff_id: string; work_date: string
  shift_pattern_name: string | null
  scheduled_start_at: string; scheduled_end_at: string
  attendance_mark: 'late' | 'left_early' | 'absent' | null
  shift_change_mark: boolean; shift_pattern_id: string | null
}

export type RequestEditTarget = {
  staffId: string; staffName: string; workDate: string; storeId: string
}

// v3.5追加（types/database.ts）
export type ScheduleMemo = {
  memo_id: string
  store_id: string
  memo_date: string  // 'YYYY-MM-DD'
  memo_text: string
  updated_at: string
}
```

---

## 画面仕様

### シフト作成画面（/schedule）

#### 公開取消機能（v3.5追加）

- **leaderのみ表示**
- **表示条件**: `publishStatus === 'published'` かつ `publishForRange.period_start > 今日（JST）`
  - 当日・過去の期間は取消不可（ボタン非表示）
  - 翌日以降が `period_start` の期間のみ取消可能
- **処理**: `shift_publish_statuses` の `status` を `draft` に戻す（`published_at`・`published_by_staff_id` も NULL にリセット）
- **UI配置**:
  - PC（lg以上）: 公開済みラベル横に「公開取消」ボタン（`border border-zinc-300` スタイル）
  - スマホ（lg未満）: ☰ドロワー内・公開済みラベルの直下
- **注意**: `unpublishSchedulePeriod` は `publishForRange.period_start` / `publishForRange.period_end` を使う（表示上の `periodStart` / `periodEnd` ではない）

```typescript
// canUnpublish の条件
const canUnpublish =
  publishStatus === 'published' &&
  periodStart !== undefined &&
  periodStart > todayYmdJst
```

#### 日別メモ欄（v3.5追加）

- **表示**: 全ロール（general・leader）・シフト/希望どちらのmodeでも常に表示
- **編集**: leaderのみ（インライン textarea・blur時に自動保存）
- **保存**: `upsertScheduleMemoAction`（`store_id, memo_date` でupsert）
- **UI**: グリッドtbodyの直後に別tbodyとしてメモ行を追加
  - 左ラベル: 「Memo」（sticky・bg-zinc-50）
  - 各日付セル: `textarea rows={2}`（leader）/ `span`（general・読み取り専用）
  - 保存後: `router.refresh()` でページ再取得

#### ガントチャートUIコンパクト化（v3.5）

以下のTailwindクラスを変更済み：

| 変更箇所 | 変更前 | 変更後 |
|---|---|---|
| スタッフ行パディング | `py-1.5` | `py-0` |
| スタッフ行gap | `gap-2` | `gap-x-2` |
| バーエリア高さ | `h-10` | `h-9` |
| 時間軸ラベル色 | `text-zinc-400` | `text-zinc-600` |
| ヘッダー日付 | `text-xs text-zinc-400` | `text-sm font-semibold text-zinc-800` |
| バー内テキスト | `text-[10px]` | `text-xs` |
| 時間軸wrapperパディング | `py-2` | `pt-0 pb-0` |
| 時間軸スペーサー | `min-h-6` | `min-h-0` |
| スタッフ名 | `text-sm ... flex items-center` | `text-sm ... leading-none` |

---

## シフト公開フロー（v3.5更新）

```
1. leader がガントを編集 → shifts にINSERT/UPDATE
2. 「公開する」ボタン → shift_publish_statuses を upsert
   period_start = 月初日 / period_end = 月末日（表示幅に関係なく月単位で保存）
   status='published' / published_at=now() / published_by_staff_id=staff_id
3. schedule/page.tsx のサーバー側フィルタで general には公開済み期間のシフトのみ渡す
4. ScheduleClient.tsx の publishForRange は publishRows と表示期間の重複で判定
5.「公開取消」ボタン → publishForRange の status を 'draft' に戻す（v3.5追加）
   条件: period_start > 今日（JST）のみ
```

---

## CSVエクスポート（v3.4）

### ヘッダー行
```
#従業員コード,勤務日,パターンコード,出勤予定,退勤予定,出勤所属コード
```

### データ行仕様
- `#従業員コード`: `staffs.staff_number`（数値のみ・`#` なし）
- `出勤予定` / `退勤予定`: 24:00より前 → `当日 HH:MM` / 以降 → `翌日 HH:MM`
- `出勤所属コード`: `shift_settings.attendance_location_code`（未設定なら空文字）
- 出力除外: `scheduled_start_at` が NULL・空の行
- 文字コード: Shift-JIS（`encoding-japanese`）
- ファイル名: `shift_YYYY-MM-DD_YYYY-MM-DD.csv`

---

## デザインシステム

### カラーパレット
```
ベース:     white / zinc-50 / zinc-100
ボーダー:   zinc-200 / zinc-300
テキスト:   zinc-900（メイン）/ zinc-500（サブ）/ zinc-400（キャプション）
アクセント: slate-600 / slate-700（プライマリ）
成功:       emerald-600（公開済み・保存成功・提出完了）
警告:       amber-50 / amber-800（未提出スタッフ）
エラー:     rose-600（締切日・エラー・削除ボタン）
今日:       slate-700（グリッドハイライト）
土曜:       sky-50 / sky-700
日祝:       rose-50 / rose-600
希望リボン: emerald-400（コーナーリボン三角）
```

### z-index 整理
```
スマホ header:           z-50
ドロワーオーバーレイ:      z-40 / ドロワー本体: z-50
thead スタッフ列 th:      z-30
thead 日付列 th:         z-20
tbody スタッフ列 td:      z-10
リボンポップアップ:       z-50
希望確認モーダル:         z-[100]
希望編集モーダル:         z-[100]
パターン選択ポップオーバー: z-[150]
iPad タップモーダル:      z-[200]
削除確認モーダル:         z-[210]
```

---

## middleware.ts の制御ロジック

```
未ログイン → /login
ログイン済み:
  active_store_id なし → /login/select-store
  /settings → general は /request にリダイレクト
  /schedule → 全ロール通過
  /request  → 全ロール通過
```

---

## 既知の問題・今後の課題

| 項目 | 状態 | 備考 |
|---|---|---|
| 祝日自動取得バッチ | ⬜ 未実装 | 内閣府API → holidaysテーブル自動インポート |
| メモセルのテキスト折り返し | ⬜ 制限あり | テーブルセル幅の制約でテキスト切れ（titleホバーで全文表示は未実装） |
| display_status='hidden'ログイン | ✅ 修正済み | |
| shift_settings未登録時の自動INSERT | ✅ 修正済み | |
| general の /schedule アクセス | ✅ 修正済み | |
| 公開機能が機能していない（general制御なし） | ✅ 修正済み(v3.4) | |
| PCでパターンからシフト登録できない | ✅ 修正済み(v3.4) | |
| CSVが文字化けする | ✅ 修正済み(v3.4) | |
| 公開取消機能がない | ✅ 修正済み(v3.5) | leaderのみ・未来期間のみ |
| 日別メモ欄がない | ✅ 修正済み(v3.5) | schedule_memosテーブル追加 |
| ガントチャートが縦に大きすぎる | ✅ 修正済み(v3.5) | 各種パディング・高さ調整 |

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

-- メモ確認（v3.5追加）
SELECT * FROM schedule_memos
WHERE store_id = '店舗ID'
ORDER BY memo_date;

-- シフト確認
SELECT shift_id, work_date, shift_pattern_name, scheduled_start_at, scheduled_end_at
FROM shifts
WHERE store_id = '店舗ID'
AND work_date BETWEEN '開始日' AND '終了日'
ORDER BY work_date;
```
