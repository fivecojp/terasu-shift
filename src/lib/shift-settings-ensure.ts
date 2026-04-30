import { createServiceClient } from '@/lib/supabase/service'
import type { ShiftSetting } from '@/types/database'

/** 店舗に shift_settings が無いときに挿入する既定値（DB と UI の共通ソース） */
export const SHIFT_SETTINGS_DEFAULTS: Omit<
  ShiftSetting,
  'store_id' | 'updated_at'
> = {
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

/**
 * shift_settings が無ければ service_role で INSERT する。
 * 並行リクエスト時は UNIQUE 競合後に再取得する。
 */
export async function ensureShiftSettingsForStore(
  storeId: string
): Promise<
  { ok: true; settings: ShiftSetting } | { ok: false; error: string }
> {
  const supabase = createServiceClient()

  const { data: existing } = await supabase
    .from('shift_settings')
    .select('*')
    .eq('store_id', storeId)
    .maybeSingle()

  if (existing) {
    return { ok: true, settings: existing as ShiftSetting }
  }

  const now = new Date().toISOString()
  const { error: insErr } = await supabase.from('shift_settings').insert({
    store_id: storeId,
    ...SHIFT_SETTINGS_DEFAULTS,
    updated_at: now,
  })

  if (insErr) {
    const dup =
      insErr.code === '23505' ||
      /duplicate key|unique constraint/i.test(insErr.message ?? '')
    if (dup) {
      const { data: after } = await supabase
        .from('shift_settings')
        .select('*')
        .eq('store_id', storeId)
        .maybeSingle()
      if (after) {
        return { ok: true, settings: after as ShiftSetting }
      }
    }
    return { ok: false, error: insErr.message }
  }

  const { data: row, error: fetchErr } = await supabase
    .from('shift_settings')
    .select('*')
    .eq('store_id', storeId)
    .single()

  if (fetchErr || !row) {
    return {
      ok: false,
      error: fetchErr?.message ?? 'シフト設定の取得に失敗しました',
    }
  }

  return { ok: true, settings: row as ShiftSetting }
}
