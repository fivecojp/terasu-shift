'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { getSession } from '@/lib/auth'
import { ensureShiftSettingsForStore } from '@/lib/shift-settings-ensure'
import {
  type PeriodSel,
  resolveGridForSelection,
} from '@/lib/shift-request-periods'

export type UpsertShiftRowPayload =
  | { request_type: 'pattern'; shift_pattern_id: string }
  | { request_type: 'free' }
  | { request_type: 'off' }
  | {
      request_type: 'custom'
      custom_start_minutes: number
      custom_end_minutes: number
    }

export type UpsertShiftRequestsInput = {
  target_month: string /* YYYY-MM-01 */
  periodSel: PeriodSel
  rows: Record<string, UpsertShiftRowPayload>
}

export async function upsertShiftRequests(
  input: UpsertShiftRequestsInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession()
  if (!session) {
    return { ok: false, error: 'ログインが必要です' }
  }

  const ensured = await ensureShiftSettingsForStore(session.store_id)
  if (!ensured.ok) {
    return { ok: false, error: ensured.error }
  }
  const set = ensured.settings

  const supabase = createServiceClient()
  const grid = resolveGridForSelection(
    input.target_month,
    set,
    input.periodSel
  )

  const allowed = new Set(grid.workDates)
  const payloadRows: Array<{
    store_id: string
    staff_id: string
    work_date: string
    target_month: string
    period_type: typeof grid.period_type
    request_type: UpsertShiftRowPayload['request_type']
    shift_pattern_id: string | null
    custom_start_minutes: number | null
    custom_end_minutes: number | null
    submitted_at: string
  }> = []

  const now = new Date().toISOString()

  for (const work_date of grid.workDates) {
    const cell = input.rows[work_date]
    if (!cell) {
      return { ok: false, error: 'すべての日付に希望を入力してください' }
    }
    if (!allowed.has(work_date)) {
      return { ok: false, error: '不正な日付が含まれています' }
    }

    if (cell.request_type === 'pattern') {
      payloadRows.push({
        store_id: session.store_id,
        staff_id: session.staff_id,
        work_date,
        target_month: input.target_month,
        period_type: grid.period_type,
        request_type: 'pattern',
        shift_pattern_id: cell.shift_pattern_id,
        custom_start_minutes: null,
        custom_end_minutes: null,
        submitted_at: now,
      })
    } else if (cell.request_type === 'free') {
      payloadRows.push({
        store_id: session.store_id,
        staff_id: session.staff_id,
        work_date,
        target_month: input.target_month,
        period_type: grid.period_type,
        request_type: 'free',
        shift_pattern_id: null,
        custom_start_minutes: null,
        custom_end_minutes: null,
        submitted_at: now,
      })
    } else if (cell.request_type === 'off') {
      payloadRows.push({
        store_id: session.store_id,
        staff_id: session.staff_id,
        work_date,
        target_month: input.target_month,
        period_type: grid.period_type,
        request_type: 'off',
        shift_pattern_id: null,
        custom_start_minutes: null,
        custom_end_minutes: null,
        submitted_at: now,
      })
    } else {
      if (cell.custom_end_minutes <= cell.custom_start_minutes) {
        return { ok: false, error: '終了時刻は開始時刻より後にしてください' }
      }
      payloadRows.push({
        store_id: session.store_id,
        staff_id: session.staff_id,
        work_date,
        target_month: input.target_month,
        period_type: grid.period_type,
        request_type: 'custom',
        shift_pattern_id: null,
        custom_start_minutes: cell.custom_start_minutes,
        custom_end_minutes: cell.custom_end_minutes,
        submitted_at: now,
      })
    }
  }

  const { error } = await supabase.from('shift_requests').upsert(payloadRows, {
    onConflict: 'store_id,staff_id,work_date',
  })

  if (error) {
    return { ok: false, error: error.message || '保存に失敗しました' }
  }

  revalidatePath('/request')
  return { ok: true }
}
