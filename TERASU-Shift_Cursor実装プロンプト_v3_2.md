# TERASU-Shift 実装プロンプト（Cursor用）v3.2

最終更新: 2026-04-29

---

## ⚠️ 最重要制約：既存DBを絶対に壊さない

このプロジェクトは **既存の Supabase データベース** に新機能を追加する作業です。

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
| PWA | manifest.json・アイコン設定済み |

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
- `display_status='hidden'` のスタッフも **ログインは可能**（シフトグリッド非表示）
- `leave_date` が設定済みのスタッフはログイン不可・シフト非表示
- general も `/schedule` にアクセス可能（閲覧専用）
- leader も `/request` にアクセス可能

---

## 既存 DB スキーマ（参照専用・変更禁止）

### companies（企業マスタ）
```
company_id / status / company_name / phone_number / admin_name
admin_email / admin_password_hash / plan / contract_start_date / contract_end_date
```

### stores（店舗マスタ）
```
store_id / company_id / store_name / store_password_hash
```

### staffs（スタッフマスタ）
```
staff_id / company_id / staff_name / staff_email(NULL) / staff_password_hash
join_date / leave_date(NULL) / birth_date / staff_note(NULL) / staff_number
```

### memberships（所属マスタ）
```
store_id / staff_id / display_status(visible|hidden) / role(general|leader) / display_order
```

### shifts（確定シフト）※RLS適用済み・変更禁止
```
shift_id / store_id / staff_id / work_date / shift_pattern_name(NULL)
scheduled_start_at(timestamptz) / scheduled_end_at(timestamptz)
attendance_mark(NULL) / shift_change_mark / shift_pattern_id(NULL・追加済み)
```

### holidays（祝日マスタ）
```
holiday_id / store_id / holiday_date / holiday_name
is_auto_imported(boolean・追加済み) / imported_at(NULL・追加済み)
```

### store_settings（店舗設定）
```
store_id / date_change_time / updated_at / gchat_webhook_url(NULL)
```

---

## 新規テーブル スキーマ

### shift_patterns
```
shift_pattern_id / store_id / pattern_name / start_minutes / end_minutes
display_order(DEFAULT 0) / is_active(DEFAULT true)
```

### shift_settings（1店舗1レコード）
```
store_id / gantt_start_minutes(DEFAULT 1080) / gantt_end_minutes(DEFAULT 1740)
shift_cycle(weekly|biweekly|semimonthly|monthly) / week_start_day(mon|sun)
deadline_type(days_before|weeks_before|months_before) / deadline_value(DEFAULT 7)
csv_format_type(NULL) / updated_at
```
未登録店舗は `ensureShiftSettingsForStore(storeId)` で自動INSERT。

### shift_requests（希望シフト）
```
shift_request_id / store_id / staff_id / work_date / target_month(月初日)
period_type(first_half|second_half|full) / request_type(pattern|free|off|custom)
shift_pattern_id(NULL) / custom_start_minutes(NULL) / custom_end_minutes(NULL)
submitted_at(DEFAULT now())
UNIQUE(store_id, staff_id, work_date) → upsertで上書き
```
週次・隔週も `period_type: 'full'` で保存。

### shift_publish_statuses
```
publish_status_id / store_id / period_start / period_end
status(draft|published) / published_at(NULL) / published_by_staff_id(NULL) / created_at
UNIQUE(store_id, period_start, period_end)
```

---

## 時刻の扱い（必須ルール）

シフトパターン・希望シフトの時刻はすべて **integer（分数）** で管理する。

```
00:00=0 / 10:00=600 / 18:00=1080 / 22:00=1320 / 25:00=1500 / 26:30=1590 / 29:00=1740
```

変換は必ず `src/lib/time.ts` の関数を使う:
```typescript
minutesToDisplay(minutes)   // 1500 → '25:00'
displayToMinutes(display)   // '25:00' → 1500
minutesToPosition(minutes, ganttStart, ganttEnd)  // ガント上の位置(%)
minutesToShort(minutes)     // 1500 → '25' / 1530 → '25.5'（表示専用・保存に使わない）
```

JST の今日日付: `Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()).slice(0, 10)`

ガント用 timestamptz → 分数変換:
```typescript
import { isoToMinutesFromWorkDateMidnight } from '@/lib/jst-shift-time'
// shifts.scheduled_start_at / scheduled_end_at（timestamptz）の変換に使う
```

例外: `shifts.scheduled_start_at` / `scheduled_end_at` は既存の `timestamptz` のまま。

---

## ⚠️ Supabaseクライアントの使い分け（最重要）

| クライアント | ファイル | RLS |
|---|---|---|
| `createBrowserClient` | `src/lib/supabase/client.ts` | 適用される |
| `createServerClient`  | `src/lib/supabase/server.ts` | 適用される |
| `createServiceClient` | `src/lib/supabase/service.ts` | **バイパス（RLSを通らない）** |

### 全 Server Actions・全 Server Component は必ず `createServiceClient()` を使う

`createServiceClient` は同期的なので `await` 不要。

---

## セッション構造

```typescript
// terasu.session cookie（JWT HS256・7日間）
{
  staff_id: string
  staff_name: string
  memberships: Array<{ store_id: string; role: 'general' | 'leader' }>
  active_store_id: string | null
}

// getSession() の戻り値（店舗確定済みのときのみ）
{ staff_id, staff_name, role, store_id }
// page.tsx では session.store_id / session.staff_id で参照する
```

---

## ファイル構成（確定版）

```
src/
  app/
    (auth)/login/page.tsx
    (auth)/login/select-store/page.tsx
    (auth)/login/layout.tsx
    (shift)/request/
      page.tsx / RequestShiftClient.tsx / RequestDateRow.tsx / actions.ts
    (shift)/schedule/
      page.tsx / ScheduleClient.tsx / ScheduleGrid.tsx
      ScheduleGantt.tsx（TapEditForm内包）/ actions.ts / types.ts
    (shift)/settings/
      page.tsx / SettingsPageClient.tsx / actions.ts
    api/auth/login/route.ts
    api/auth/logout/route.ts
    api/auth/select-store/route.ts
  lib/
    time.ts                     minutesToDisplay / displayToMinutes / minutesToPosition / minutesToShort
    auth.ts                     getSession() / getSessionPayload()
    session-token.ts
    logout-client.ts
    shift-settings-ensure.ts    ensureShiftSettingsForStore()
    shift-request-periods.ts    期間・締切・buildRequestPathForSel・resolveNextPeriodPath
    schedule-view-range.ts      表示幅ロジック
    jst-shift-time.ts           isoToMinutesFromWorkDateMidnight / snapMinutes
    supabase/client.ts / server.ts / service.ts
  middleware.ts
  types/database.ts
public/manifest.json / icons/
```

---

## 主要ライブラリ・関数

### src/lib/shift-request-periods.ts

```typescript
type PeriodSettingsForRequest = Pick<ShiftSetting,
  'shift_cycle' | 'week_start_day' | 'deadline_type' | 'deadline_value'>

// settings 引数はこの型に統一（ShiftSetting はそのまま渡せる）

listPeriodsWithDeadlines(targetMonthFirst, settings): PeriodDeadlineInfo[]
// PeriodDeadlineInfo.periodFirstYmd は期間先頭の YYYY-MM-DD（月初とは限らない）

resolveGridForSelection(targetMonthFirst, settings, sel): { period_type, workDates }
// weekly / biweekly は period_type: 'full' を返す

isDeadlineExpiredVsToday(deadlineYmd, todayYmd): boolean
addOneMonthFirst(targetMonthFirst): string
findFirstOpenPeriodInMonth(targetMonthFirst, settings, todayYmd): PeriodDeadlineInfo | null
resolveDefaultRequestMonthAndPeriod(settings, todayYmd): { targetMonthFirst, periodSel }
buildRequestPathForSel(ym7, sel): string  // /request?ym=...&period=... 等を生成
resolveNextPeriodPath(targetMonthFirst, currentSel, settings, todayYmd): string | null
```

---

## 画面仕様

### 希望シフト提出（/request）

#### デフォルトリダイレクト（?ym なし）
```typescript
// page.tsx サーバー側で以下の優先順で期間を決定
// 優先①②: 締切前 & 未提出の最初の期間（DBで shift_requests を確認）
// 優先③④: 締切前の最初の期間（提出済みでも）
// 優先⑤: resolveDefaultRequestMonthAndPeriod フォールバック
```

#### 提出フロー
```
提出ボタン → submitting（送信中スピナー）
→ done（✓ 提出しました）
→ 1秒後: nextPeriodPath があれば router.push / なければ router.refresh
```

#### 提出済み後のロック
- `isSubmitted` によるボタン・日付行・期間ボタンのロックは**なし**
- `formLocked`（締切判定）のみで無効化
- 提出済みバナーに「修正する」+「次の期間へ →」（nextPeriodPath ありのみ）

#### nextPeriodPath の計算
```typescript
// RequestShiftClient.tsx で useMemo により periodSel 変化時に再計算
const nextPeriodPath = useMemo(() =>
  resolveNextPeriodPath(targetMonthFirst, periodSel, settingsForClient, todayYmd),
  [periodSel, targetMonthFirst, settingsForClient, todayYmd]
)
// settingsForClient は page.tsx から props で渡す（4フィールドのみ）
// todayYmd は page.tsx で JST 計算して props で渡す
```

### シフト作成（/schedule）

#### コーナーリボン（全ロール）
- `allRequests`（`shift_requests`）を page.tsx で取得して ScheduleGrid に渡す
- `requestMap = Map<'staffId_workDate', RequestSummary>` で高速参照
- セル右上の緑三角リボン: PC ホバー / スマホタップでポップアップ
- `openRibbonKey` state で管理

#### 日付ヘッダークリック（leader のみ・シフトモード）
- 日付 th クリック → `onPickCell(date)` でガント表示

#### シフトセルタップ（leader のみ）
- 希望あり → 希望確認モーダル（「閉じる」/「シフトを編集」）
- 希望なし → 直接ガント表示

#### ガントチャート

バー表示:
```typescript
// isoToMinutesFromWorkDateMidnight で開始・終了を分数に変換
// minutesToPosition で left% / width% を計算
// shift_pattern_name があればパターン名・なければ `開始–終了`
// width < 5% はラベル invisible
// scheduled_end_at が null → 幅 2% / bg-zinc-400
```

onSave シグネチャ:
```typescript
onSave: (staffId: string, startMin: number, endMin: number) => Promise<void>
// workDate・patternId は渡せない（workDate はコンポーネントの props）
```

iPad タップ編集（TapEditForm）:
```typescript
// isTouchDevice: useState + useEffect で判定（SSR対応）
// タップ → TapEditModal state → TapEditForm モーダル
// パターン選択: patternsById（Map）から is_active のみ表示
//   → onSave(staffId, p.start_minutes, p.end_minutes)
// 時間指定: ganttStart〜ganttEnd の30分刻み select
//   → onSave(staffId, startMin, endMin)
// onDelete なし（props に存在しないため）
// z-index: z-[200]（リボン z-50・希望確認モーダル z-[100] より手前）
```

### 月移動フィードバック（ScheduleClient.tsx）
```typescript
// isNavigating state
// goMonthNav(path): setIsNavigating(true) → router.push(path)
// 遷移中: opacity-50 pointer-events-none + スピナー
// PC・スマホ・ドロワー内すべて同じ isNavigating を共有
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
  deadline_value: number; csv_format_type: string | null; updated_at: string
}

export type Shift = {
  shift_id: string; store_id: string; staff_id: string; work_date: string
  shift_pattern_name: string | null
  scheduled_start_at: string; scheduled_end_at: string
  attendance_mark: 'late' | 'left_early' | 'absent' | null
  shift_change_mark: boolean; shift_pattern_id: string | null
}
```

---

## 実装上の注意

- `shift_requests` の保存は必ずupsert: `.upsert(data, { onConflict: 'store_id,staff_id,work_date' })`
- スタッフ表示フィルタ: `.eq('display_status', 'visible').or('leave_date.is.null,leave_date.gt.' + today)`
- `shift_settings` 未登録は `ensureShiftSettingsForStore()` で自動INSERT
- `shifts.shift_pattern_name` は後方互換で残す。新規作成時は `shift_pattern_id` も同時にセット
- `scheduled_start_at` / `scheduled_end_at` は timestamptz（JST変換して保存）
- TypeScript strict モード / `any`型禁止 / Supabaseレスポンスは必ず `error` チェック
- Server Component デフォルト・インタラクション部分のみ `'use client'`
- JST 今日日付: `Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()).slice(0, 10)`
- `minutesToShort` は表示専用（保存・計算に使わない）
- `isTouchDevice` は `useState(false)` + `useEffect` で設定（SSR で `window` 参照しない）
- iPad タップ編集の `onSave` に `patternId` は渡せない（パターン選択時も `start_minutes` / `end_minutes` で保存）
