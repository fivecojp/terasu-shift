# TERASU-Shift 実装プロンプト（Cursor用）v2

最終更新: 2026-04-28

---

## ⚠️ 最重要制約：既存DBを絶対に壊さない

このプロジェクトは **既存の Supabase データベース** に新機能を追加する作業です。
以下のルールを実装の全工程で守ること。

### 絶対にやってはいけないこと
- 既存テーブルへの `ALTER TABLE`（カラム追加・削除・型変更）
- 既存テーブルへの `DROP`・`TRUNCATE`
- 既存 RLS ポリシーの `DROP` または `CREATE`（新規4テーブル以外）
- 既存テーブルのカラム名・型を前提としたコードの書き換え
- `supabase db push` や `supabase migration` の実行

### 新規追加済みのテーブル（読み書きOK）
```
shift_patterns          シフトパターンマスタ
shift_settings          シフト設定
shift_requests          希望シフト
shift_publish_statuses  シフト公開管理
```

### 既存テーブルへの追加済みカラム（参照のみ）
```
shifts.shift_pattern_id        uuid  NULL  FK → shift_patterns
holidays.is_auto_imported      boolean  DEFAULT false
holidays.imported_at           timestamptz  NULL
```

---

## プロジェクト概要

| 項目 | 内容 |
|---|---|
| アプリ名 | TERASU-Shift |
| 目的 | バー・ナイトクラブ複数店舗のスタッフ希望シフト収集・シフト作成・公開 |
| スタック | Next.js 16 (App Router) / TypeScript / Tailwind CSS / Supabase |
| 認証 | 独自実装（Supabase Auth不使用）staffs.staff_email + bcryptjs |
| セッション | jose (JWT HS256) / httpOnly cookie（terasu.session） |
| デプロイ | Vercel + Supabase |
| デバイス | シフト入力=スマホ / シフト作成・設定=PC/タブレット |

---

## 環境変数

| 変数名 | 用途 | 備考 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | SupabaseプロジェクトURL | 公開可 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anonキー | 公開可 |
| `SUPABASE_SERVICE_ROLE_KEY` | RLSバイパス用 | サーバーサイド専用 |
| `AUTH_SECRET` | JWT署名用 | 32文字以上・サーバーサイド専用 |

---

## ロール定義

| role | できること |
|---|---|
| `general` | 希望シフト提出・確定シフト閲覧（published分のみ） |
| `leader` | 全機能（シフト作成・編集・公開・設定・CSV出力） |

### 重要な仕様
- `display_status='hidden'` のスタッフも **ログインは可能**
  - シフトグリッドへの表示は `display_status='visible'` のみ
  - シフトに入らない責任者（leader）がいるケースに対応
  - ログインAPIで `display_status` による絞り込みをしない
- `leave_date` が設定済みのスタッフはログイン不可・シフト非表示

---

## 既存 DB スキーマ（参照専用・変更禁止）

### companies（企業マスタ）
```
company_id          uuid        PK
status              enum        public / private
company_name        text
phone_number        text        NULL
admin_name          text
admin_email         text        UNIQUE
admin_password_hash text
plan                text
contract_start_date date
contract_end_date   date
```

### stores（店舗マスタ）
```
store_id            uuid        PK
company_id          uuid        FK → companies
store_name          text
store_password_hash text
```

### staffs（スタッフマスタ）
```
staff_id            uuid        PK
company_id          uuid        FK → companies
staff_name          text
staff_email         text        NULL（leaderのみ）
staff_password_hash text        bcryptハッシュ
join_date           date
leave_date          date        NULL（退社済みで設定）
birth_date          date
staff_note          text        NULL
staff_number        integer     CSV出力の従業員コード
```

### memberships（所属マスタ）
```
store_id        uuid    PK（複合）FK → stores
staff_id        uuid    PK（複合）FK → staffs
display_status  enum    visible / hidden
role            enum    general / leader
display_order   integer
```

### shifts（確定シフト）※RLS適用済み・変更禁止
```
shift_id            uuid        PK
store_id            uuid        FK → stores
staff_id            uuid        FK → staffs
work_date           date
shift_pattern_name  text        NULL（後方互換カラム）
scheduled_start_at  timestamptz
scheduled_end_at    timestamptz
attendance_mark     enum        NULL（late / left_early / absent）
shift_change_mark   boolean
shift_pattern_id    uuid        NULL FK → shift_patterns  ← 追加済み
```

### holidays（祝日マスタ）
```
holiday_id          uuid    PK
store_id            uuid    FK → stores
holiday_date        date    UNIQUE per store
holiday_name        text
is_auto_imported    boolean DEFAULT false  ← 追加済み
imported_at         timestamptz NULL       ← 追加済み
```

### store_settings（店舗設定）
```
store_id            uuid    PK FK → stores
date_change_time    time    DEFAULT 05:00
updated_at          timestamp
gchat_webhook_url   text    NULL
```

---

## 新規テーブル スキーマ

### shift_patterns（シフトパターンマスタ）
```
shift_pattern_id  uuid     PK
store_id          uuid     FK → stores
pattern_name      text     UNIQUE per store
start_minutes     integer  0=00:00 / 600=10:00 / 1320=22:00 / 1500=25:00
end_minutes       integer  end > start（最大2880）
display_order     integer  DEFAULT 0
is_active         boolean  DEFAULT true（削除は論理削除のみ）
```

### shift_settings（シフト設定）1店舗1レコード
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

未登録店舗は `ensureShiftSettingsForStore(storeId)` で自動INSERT。
デフォルト値: `{ gantt_start_minutes:1080, gantt_end_minutes:1740, shift_cycle:'semimonthly', week_start_day:'mon', deadline_type:'days_before', deadline_value:7 }`

### shift_requests（希望シフト）
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

週次・隔週の `period_type` は `full` で保存し日付範囲で期間を区別する。

### shift_publish_statuses（シフト公開管理）
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
```

shiftsテーブル自体にステータスカラムは持たせない。
generalの確定シフト表示はRLSが `shift_publish_statuses.status='published'` で制御する。

---

## 時刻の扱い（必須ルール）

シフトパターン・希望シフトの時刻はすべて **integer（分数）** で管理する。

理由:
- `time`型は23:59:59まで → バーの深夜時間（25:00等）を格納不可
- `timestamptz`はUTC変換でバグ発生リスク（1970-01-01 22:00 JST → 1969-12-31 13:00 UTCになる）

```
00:00=0 / 10:00=600 / 18:00=1080 / 22:00=1320 / 25:00=1500 / 26:30=1590 / 29:00=1740
```

変換は必ず `src/lib/time.ts` の関数を使う:
```typescript
minutesToDisplay(minutes)   // 1500 → '25:00'
displayToMinutes(display)   // '25:00' → 1500
minutesToPosition(minutes, ganttStart, ganttEnd)  // ガント上の位置(%)
```

例外: `shifts.scheduled_start_at` / `scheduled_end_at` は既存の `timestamptz` のまま。
保存時は Asia/Tokyo で変換して格納する。

---

## Supabaseクライアントの使い分け

| クライアント | ファイル | RLS |
|---|---|---|
| `createBrowserClient` | `src/lib/supabase/client.ts` | 適用される |
| `createServerClient` | `src/lib/supabase/server.ts` | 適用される |
| `createServiceClient` | `src/lib/supabase/service.ts` | **バイパス** |

### service_roleを使う箇所（既存テーブルはRLSポリシーなし・anonから読めない）
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/select-store/route.ts`
- `src/app/(auth)/login/select-store/page.tsx`
- `src/app/(shift)/schedule/page.tsx`
- `src/app/(shift)/request/page.tsx`
- `src/app/(shift)/settings/page.tsx`
- 全Server Actions

---

## セッション構造

```typescript
// terasu.session cookie（JWT HS256・7日間）
{
  staff_id: string
  staff_name: string
  memberships: Array<{ store_id: string; role: 'general' | 'leader' }>
  active_store_id: string | null  // 複数店舗は選択後にセット
}

// getSession() の戻り値（店舗確定済みのときのみ）
{ staff_id, staff_name, role, store_id }
```

複数店舗所属: ログイン → `active_store_id:null` → `/login/select-store` → `/api/auth/select-store` でcookie更新

---

## ファイル構成（確定版）

```
src/
  app/
    (auth)/
      login/
        page.tsx
        select-store/page.tsx
        layout.tsx
    (shift)/
      request/
        page.tsx
        RequestShiftClient.tsx
        RequestDateRow.tsx
        actions.ts
      schedule/
        page.tsx
        ScheduleClient.tsx
        ScheduleGrid.tsx
        ScheduleGantt.tsx
        actions.ts
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
    time.ts                     分数変換ユーティリティ
    auth.ts                     getSession()
    session-token.ts            JWT encode/decode
    logout-client.ts            logoutAndRedirectToLogin()
    shift-settings-ensure.ts    ensureShiftSettingsForStore()
    shift-request-periods.ts    期間・締切・週スライスロジック
    schedule-view-range.ts      表示幅（1週/2週/半月/1か月）
    jst-shift-time.ts           JST変換（CSV・セル表示）
    supabase/
      client.ts
      server.ts
      service.ts
  middleware.ts
  types/
    database.ts
```

---

## 画面仕様

### ログイン（/login）
- `staff_email` + `password` で認証
- `leave_date` 設定済みはログイン不可
- `display_status='hidden'` でもログイン可（シフト非表示だがログインは許可）
- 1店舗 → role別ホームへ / 複数店舗 → `/login/select-store`

### 希望シフト提出（/request）スマホ最適化
- 締切日・スタッフ名・対象月・期間セレクタ
- 日付ごとにdropdown（shift_patterns / F / × / その他）
- その他: ガント範囲を30分刻みで選択
- 土曜=青・日曜/祝日=赤
- 提出済みバナー + 「修正する」ボタン
- 保存: `upsert(onConflict: 'store_id,staff_id,work_date')`
- ヘッダーにログアウトボタン

### シフト作成（/schedule）PC/タブレット
- 月移動（`?ym=YYYY-MM`）/ 表示期間切替 / 希望↔シフトトグル
- 公開ステータス + 「公開する」ボタン
- CSVエクスポート / 未提出スタッフ警告
- 「設定」リンク（leaderのみ）/ ログアウトボタン
- グリッド: スタッフ×日付（display_status=visible・leave_date未設定）
- ガントチャート:
  - バー左端ドラッグ=開始時刻変更
  - バー右端ドラッグ=終了時刻変更
  - バー中央ドラッグ=移動
  - 最小幅30分
  - 希望シフトを薄く参考表示（編集不可）

### シフト設定（/settings）leaderのみ
- シフトパターンCRUD（論理削除・is_active=false）
- ガントチャート表示時間 / シフトサイクル / 締切設定
- 保存時トースト通知 / ログアウトボタン / シフト作成へ戻るリンク

### シフト公開フロー
```
1. leaderがガントを編集 → shifts にINSERT/UPDATE（generalには非表示）
2. 「公開する」ボタン → shift_publish_statuses を upsert
   status='published' / published_at=now() / published_by_staff_id=staff_id
3. その瞬間からgeneralのRLSが通る → スタッフのシフト画面に表示
```

### CSVエクスポート
```
#従業員コード,勤務日,パターンコード,出勤予定,退勤予定,出勤所属コード
```
- `#従業員コード` = `staffs.staff_number`
- `パターンコード` = `shifts.shift_pattern_name`
- `出勤予定/退勤予定` = JST HH:mm形式
- 最終行は改行で終了

---

## TypeScript 型定義

```typescript
export type ShiftPattern = {
  shift_pattern_id: string
  store_id: string
  pattern_name: string
  start_minutes: number
  end_minutes: number
  display_order: number
  is_active: boolean
}

export type ShiftRequest = {
  shift_request_id: string
  store_id: string
  staff_id: string
  work_date: string           // 'YYYY-MM-DD'
  target_month: string        // 'YYYY-MM-01'
  period_type: 'first_half' | 'second_half' | 'full'
  request_type: 'pattern' | 'free' | 'off' | 'custom'
  shift_pattern_id: string | null
  custom_start_minutes: number | null
  custom_end_minutes: number | null
  submitted_at: string
}

export type ShiftPublishStatus = {
  publish_status_id: string
  store_id: string
  period_start: string
  period_end: string
  status: 'draft' | 'published'
  published_at: string | null
  published_by_staff_id: string | null
  created_at: string
}

export type ShiftSetting = {
  store_id: string
  gantt_start_minutes: number
  gantt_end_minutes: number
  shift_cycle: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'
  week_start_day: 'mon' | 'sun'
  deadline_type: 'days_before' | 'weeks_before' | 'months_before'
  deadline_value: number
  csv_format_type: string | null
  updated_at: string
}

export type Staff = {
  staff_id: string
  company_id: string
  staff_name: string
  staff_email: string | null
  staff_password_hash: string
  join_date: string
  leave_date: string | null
  birth_date: string
  staff_note: string | null
  staff_number: number
}

export type Membership = {
  store_id: string
  staff_id: string
  display_status: 'visible' | 'hidden'
  role: 'general' | 'leader'
  display_order: number
}

export type Shift = {
  shift_id: string
  store_id: string
  staff_id: string
  work_date: string
  shift_pattern_name: string | null
  scheduled_start_at: string
  scheduled_end_at: string
  attendance_mark: 'late' | 'left_early' | 'absent' | null
  shift_change_mark: boolean
  shift_pattern_id: string | null
}
```

---

## 実装上の注意

- `shift_requests` の保存は必ずupsert: `.upsert(data, { onConflict: 'store_id,staff_id,work_date' })`
- スタッフ表示フィルタ: `.eq('display_status', 'visible').or('leave_date.is.null,leave_date.gt.' + today)`
- `shift_settings` 未登録は `ensureShiftSettingsForStore()` で自動INSERT（エラーにしない）
- `shifts.shift_pattern_name` は後方互換で残す。新規作成時は `shift_pattern_id` も同時にセット
- `scheduled_start_at` / `scheduled_end_at` は timestamptz（JST変換して保存）
- TypeScript strict モード / `any`型禁止 / Supabaseレスポンスは必ず`error`チェック
- Server Componentデフォルト・インタラクション部分のみ `'use client'`
