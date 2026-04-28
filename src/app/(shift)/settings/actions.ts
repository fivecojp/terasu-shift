'use server'

import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import type { ShiftPattern, ShiftSetting } from '@/types/database'

async function requireLeaderStore() {
  const session = await getSession()
  if (!session || session.role !== 'leader') return null
  return session
}

export type ShiftSettingsUpsertInput = Omit<
  ShiftSetting,
  'updated_at'
> & { updated_at?: string }

export async function upsertShiftSettingsAction(
  input: ShiftSettingsUpsertInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireLeaderStore()
  if (!session) return { ok: false, error: '権限がありません' }
  if (input.store_id !== session.store_id) {
    return { ok: false, error: '店舗が一致しません' }
  }
  if (input.gantt_end_minutes <= input.gantt_start_minutes) {
    return { ok: false, error: 'ガントの終了時刻は開始より後にしてください' }
  }
  if (input.deadline_value < 1 || !Number.isFinite(input.deadline_value)) {
    return { ok: false, error: '締切の数値は1以上にしてください' }
  }

  const supabase = createServiceClient()
  const updated_at = new Date().toISOString()
  const row = {
    ...input,
    updated_at,
  }

  const { error } = await supabase.from('shift_settings').upsert(row, {
    onConflict: 'store_id',
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings')
  revalidatePath('/schedule')
  revalidatePath('/request')
  return { ok: true }
}

export async function createShiftPatternAction(input: {
  pattern_name: string
  start_minutes: number
  end_minutes: number
  display_order: number
  is_active: boolean
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireLeaderStore()
  if (!session) return { ok: false, error: '権限がありません' }
  if (input.end_minutes <= input.start_minutes) {
    return { ok: false, error: '終了時刻は開始時刻より後にしてください' }
  }

  const supabase = createServiceClient()
  const { error } = await supabase.from('shift_patterns').insert({
    store_id: session.store_id,
    pattern_name: input.pattern_name.trim(),
    start_minutes: input.start_minutes,
    end_minutes: input.end_minutes,
    display_order: input.display_order,
    is_active: input.is_active,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings')
  return { ok: true }
}

export async function updateShiftPatternAction(
  input: Pick<
    ShiftPattern,
    | 'shift_pattern_id'
    | 'pattern_name'
    | 'start_minutes'
    | 'end_minutes'
    | 'display_order'
    | 'is_active'
  >
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireLeaderStore()
  if (!session) return { ok: false, error: '権限がありません' }
  if (input.end_minutes <= input.start_minutes) {
    return { ok: false, error: '終了時刻は開始時刻より後にしてください' }
  }

  const supabase = createServiceClient()
  const { data: existing } = await supabase
    .from('shift_patterns')
    .select('store_id')
    .eq('shift_pattern_id', input.shift_pattern_id)
    .maybeSingle()

  if (!existing || existing.store_id !== session.store_id) {
    return { ok: false, error: 'パターンが見つかりません' }
  }

  const { error } = await supabase
    .from('shift_patterns')
    .update({
      pattern_name: input.pattern_name.trim(),
      start_minutes: input.start_minutes,
      end_minutes: input.end_minutes,
      display_order: input.display_order,
      is_active: input.is_active,
    })
    .eq('shift_pattern_id', input.shift_pattern_id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings')
  return { ok: true }
}

/** 論理削除: is_active = false のみ（物理削除しない） */
export async function deactivateShiftPatternAction(
  shift_pattern_id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireLeaderStore()
  if (!session) return { ok: false, error: '権限がありません' }

  const supabase = createServiceClient()
  const { data: existing } = await supabase
    .from('shift_patterns')
    .select('store_id')
    .eq('shift_pattern_id', shift_pattern_id)
    .maybeSingle()

  if (!existing || existing.store_id !== session.store_id) {
    return { ok: false, error: 'パターンが見つかりません' }
  }

  const { error } = await supabase
    .from('shift_patterns')
    .update({ is_active: false })
    .eq('shift_pattern_id', shift_pattern_id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings')
  return { ok: true }
}
