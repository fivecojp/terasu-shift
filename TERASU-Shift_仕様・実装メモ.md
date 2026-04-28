# TERASU-Shift 仕様・実装メモ

最終更新: 2026-04-28  
バージョン: v1.0（初回デプロイ完了時点）

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
| デバイス | シフト入力=スマホ / シフト作成・設定=PC/タブレット |

---

## 環境変数

| 変数名 | 用途 | 備考 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | SupabaseプロジェクトURL | 公開可 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon キー | 公開可 |
| `SUPABASE_SERVICE_ROLE_KEY` | RLSバイパス用 | サーバーサイド専用・絶対に公開しない |
| `AUTH_SECRET` | JWT署名用 | 32文字以上・サーバーサイド専用 |

---

## ロール定義

| role | できること | できないこと |
|---|---|---|
| `general` | 希望シフト提出・確定シフト閲覧（published分のみ） | シフト作成・設定・CSV出力 |
| `leader` | 全機能（シフト作成・編集・公開・設定・CSV出力） | - |

### 重要な仕様決定
- `display_status='hidden'` のスタッフも **ログインは可能**
  - シフトグリッドへの表示は `display_status='visible'` のみ
  - シフトに入らない責任者（leader）がいるケースに対応
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
shifts.shift_pattern_id     uuid  NULL  FK → shift_patterns  -- 追加済み
holidays.is_auto_imported   boolean  DEFAULT false            -- 追加済み
holidays.imported_at        timestamptz  NULL                 -- 追加済み
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

shifts テーブル自体にステータスカラムは持たせない。  
shifts の general 向け表示は RLS が `shift_publish_statuses.status='published'` で制御。

---

## 時刻の扱い（重要）

### なぜ integer（分数）を採用したか
- `time` 型: 23:59:59 までしか扱えず、バーの深夜営業（25:00, 26:30等）を格納不可
- `timestamptz`: Supabase(PostgreSQL)はUTC保存のため、JSフロント側で
  `1970-01-01 22:00 JST` → `1969-12-31 13:00 UTC` に変換され
  年またぎ・月またぎの予期せぬバグを引き起こすリスクがある
- **integer（分数）**: タイムゾーン変換が一切発生しない

### 変換ルール
```
00:00 = 0 / 10:00 = 600 / 18:00 = 1080
22:00 = 1320 / 25:00 = 1500 / 26:30 = 1590
29:00（翌5:00）= 1740 / 最大 2880（48:00）
```

### 変換ユーティリティ（src/lib/time.ts）
```typescript
export function minutesToDisplay(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
export function displayToMinutes(display: string): number {
  const [h, m] = display.split(':').map(Number)
  return h * 60 + m
}
export function minutesToPosition(minutes: number, ganttStart: number, ganttEnd: number): number {
  return ((minutes - ganttStart) / (ganttEnd - ganttStart)) * 100
}
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

### service_role を使う箇所
- `src/app/api/auth/login/route.ts`（staffs・memberships・stores取得）
- `src/app/(auth)/login/select-store/page.tsx`（stores取得）
- `src/app/(shift)/schedule/page.tsx`（全データ取得）
- `src/app/(shift)/request/page.tsx`（全データ取得）
- `src/app/(shift)/settings/page.tsx`（全データ取得）
- 全Server Actions（shift_patterns / shift_settings / shifts / shift_publish_statuses の更新）

---

## RLS設計

### 新規テーブルのポリシー（適用済み）

| テーブル | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| shift_patterns | 同店舗全員 | leaderのみ | leaderのみ | leaderのみ |
| shift_settings | 同店舗全員 | leaderのみ | leaderのみ | leaderのみ |
| shift_requests | 自分+同店舗leader | 自分のみ | 自分のみ | 全拒否 |
| shift_publish_statuses | 同店舗全員 | leaderのみ | leaderのみ | 全拒否 |
| shifts（既存） | published期間のみ/leader無制限 | leaderのみ | leaderのみ | 全拒否 |

### 既存テーブル（staffs / memberships / stores）
- RLSは有効だがポリシーなし（anon キーからは読めない）
- → ログイン・店舗選択など認証系は必ず `createServiceClient()` を使う

---

## ファイル構成

```
src/
  app/
    (auth)/
      login/
        page.tsx              ログイン画面
        select-store/
          page.tsx            複数店舗選択画面
        layout.tsx            useSearchParams用Suspense
    (shift)/
      request/
        page.tsx              希望シフト提出画面（Server Component）
        RequestShiftClient.tsx クライアント部分
        RequestDateRow.tsx    日付行コンポーネント
        actions.ts            upsertShiftRequests
      schedule/
        page.tsx              シフト作成画面（Server Component）
        ScheduleClient.tsx    クライアント部分
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
    auth.ts                   getSession()
    session-token.ts          encodeSessionToken / decodeSessionToken
    logout-client.ts          logoutAndRedirectToLogin()
    shift-settings-ensure.ts  ensureShiftSettingsForStore()
    shift-request-periods.ts  期間・締切・週スライスロジック
    schedule-view-range.ts    表示幅（1週/2週/半月/1か月）
    jst-shift-time.ts         JST変換（CSV・セル表示用）
    supabase/
      client.ts               createBrowserClient
      server.ts               createServerClient
      service.ts              createServiceClient（RLSバイパス）
  middleware.ts               未ログイン→/login / general→/schedule禁止
  types/
    database.ts               型定義
```

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
  active_store_id: string | null  // 複数店舗の場合は選択後にセット
  iat: number
  exp: number  // 7日間
}
```

複数店舗所属の場合: ログイン時は `active_store_id: null` → `/login/select-store` で選択 → `/api/auth/select-store` がcookieを更新。

---

## 画面仕様

### ログイン画面（/login）
- `staff_email` + `password` で認証
- `leave_date` 設定済みはログイン不可
- `display_status='hidden'` でもログイン可能（シフト非表示だがログインは許可）
- 1店舗所属 → role別ホームへ
- 複数店舗所属 → `/login/select-store`

### 希望シフト提出画面（/request）スマホ最適化
- 締切日表示（`deadline_type` + `deadline_value` から計算）
- 対象月（今月・来月）+ 期間（shift_cycleに応じて）
- 日付ごとにdropdown: shift_patterns / F（free）/ ×（off）/ その他（custom）
- その他: `gantt_start_minutes` ～ `gantt_end_minutes` を30分刻み
- 土曜=青・日曜/祝日=赤
- 提出済みバナー + 「修正する」ボタンで再編集
- 保存: `upsert(onConflict: 'store_id,staff_id,work_date')`

### シフト作成画面（/schedule）PC/タブレット
- 月移動（`?ym=YYYY-MM`）
- 表示期間: 1週間 / 2週間 / 半月 / 1か月
- 「希望｜シフト」トグル
- 公開ステータス + 「公開する」ボタン（draft→published）
- CSVエクスポート
- 未提出スタッフ警告バナー
- 「設定」へのリンク（leaderのみ表示）
- グリッド: スタッフ×日付
  - 希望表示: pattern名 / F（薄ピンク）/ ×（グレー）/ 時刻
  - シフト表示: pattern名 or 時刻（H-H形式・0省略）
  - セルクリックでガントチャート表示
- ガントチャート:
  - バー左端ドラッグ=開始時刻変更
  - バー右端ドラッグ=終了時刻変更
  - バー中央ドラッグ=移動
  - 最小幅30分
  - 希望シフトを薄く参考表示

### シフト設定画面（/settings）leaderのみ
- シフトパターンCRUD（論理削除・is_active=false）
- ガントチャート表示時間設定
- シフトサイクル・週始まり設定
- 希望シフト締切設定
- 保存時トースト通知

### CSVエクスポート
```
#従業員コード,勤務日,パターンコード,出勤予定,退勤予定,出勤所属コード
```
- `#従業員コード` = `staffs.staff_number`
- `パターンコード` = `shifts.shift_pattern_name`
- `出勤予定/退勤予定` = JST HH:mm形式
- 最終行は改行で終了

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
| シフト作成画面への設定リンク | ⬜ 要追加 | ScheduleClient.tsxヘッダーに「設定」ボタン追加 |
| display_status='hidden'ログイン | ✅ 修正済み | login/route.tsのdisplay_status条件を削除 |
| shift_settings未登録時の自動INSERT | ✅ 修正済み | ensureShiftSettingsForStore()で対応 |
| 複数devサーバー起動 | ✅ 対応済み | taskkill /PID xxxxx /F で旧サーバーを停止 |

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

-- RLSポリシー確認
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN (
  'shift_patterns','shift_settings','shift_requests',
  'shift_publish_statuses','shifts'
)
ORDER BY tablename, policyname;

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
