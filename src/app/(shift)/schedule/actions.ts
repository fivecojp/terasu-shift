'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { getSession } from '@/lib/auth'
import { formatJstHHmm, workDateMinutesToIso } from '@/lib/jst-shift-time'
import { ymParamToTargetFirst } from '@/lib/shift-request-periods'

async function requireLeader() {
  const session = await getSession()
  if (!session || session.role !== 'leader') {
    return null
  }
  return session
}

export async function upsertShiftTimes(input: {
  work_date: string
  staff_id: string
  scheduled_start_at: string
  scheduled_end_at: string
  shift_pattern_id?: string | null
  shift_pattern_name?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireLeader()
  if (!session) return { ok: false, error: '権限がありません' }

  const supabase = createServiceClient()

  const { data: existing } = await supabase
    .from('shifts')
    .select('shift_id')
    .eq('store_id', session.store_id)
    .eq('staff_id', input.staff_id)
    .eq('work_date', input.work_date)
    .maybeSingle()

  const row = {
    store_id: session.store_id,
    staff_id: input.staff_id,
    work_date: input.work_date,
    scheduled_start_at: input.scheduled_start_at,
    scheduled_end_at: input.scheduled_end_at,
    shift_pattern_id: input.shift_pattern_id ?? null,
    shift_pattern_name: input.shift_pattern_name ?? null,
    attendance_mark: null,
    shift_change_mark: false,
  }

  if (existing?.shift_id) {
    const { error } = await supabase
      .from('shifts')
      .update(row)
      .eq('shift_id', existing.shift_id)
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await supabase.from('shifts').insert(row)
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/schedule')
  return { ok: true }
}

export async function publishSchedulePeriod(input: {
  period_start: string
  period_end: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireLeader()
  if (!session) return { ok: false, error: '権限がありません' }

  const supabase = createServiceClient()
  const nowIso = new Date().toISOString()

  const { data: row } = await supabase
    .from('shift_publish_statuses')
    .select('publish_status_id, status')
    .eq('store_id', session.store_id)
    .eq('period_start', input.period_start)
    .eq('period_end', input.period_end)
    .maybeSingle()

  if (!row) {
    const { error: insErr } = await supabase.from('shift_publish_statuses').insert({
      store_id: session.store_id,
      period_start: input.period_start,
      period_end: input.period_end,
      status: 'published',
      published_at: nowIso,
      published_by_staff_id: session.staff_id,
    })
    if (insErr) return { ok: false, error: insErr.message }
  } else {
    const { error: upErr } = await supabase
      .from('shift_publish_statuses')
      .update({
        status: 'published',
        published_at: nowIso,
        published_by_staff_id: session.staff_id,
      })
      .eq('publish_status_id', row.publish_status_id)
    if (upErr) return { ok: false, error: upErr.message }
  }

  revalidatePath('/schedule')
  return { ok: true }
}

export async function ensureDraftPublishRow(input: {
  period_start: string
  period_end: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireLeader()
  if (!session) return { ok: false, error: '権限がありません' }

  const supabase = createServiceClient()

  const { data: row } = await supabase
    .from('shift_publish_statuses')
    .select('publish_status_id')
    .eq('store_id', session.store_id)
    .eq('period_start', input.period_start)
    .eq('period_end', input.period_end)
    .maybeSingle()

  if (row) return { ok: true }

  const { error } = await supabase.from('shift_publish_statuses').insert({
    store_id: session.store_id,
    period_start: input.period_start,
    period_end: input.period_end,
    status: 'draft',
    published_at: null,
    published_by_staff_id: null,
  })

  if (error) return { ok: false, error: error.message }
  revalidatePath('/schedule')
  return { ok: true }
}

export async function buildScheduleCsv(input: {
  ym: string
}): Promise<{ ok: true; csv: string } | { ok: false; error: string }> {
  const session = await requireLeader()
  if (!session) return { ok: false, error: '権限がありません' }

  const monthFirst =
    ymParamToTargetFirst(input.ym) ??
    (/^\d{4}-\d{2}$/.test(input.ym) ? `${input.ym}-01` : null)
  if (!monthFirst) return { ok: false, error: '無効な年月です' }

  const supabase = createServiceClient()
  const d = new Date(monthFirst + 'T12:00:00')
  const y = d.getFullYear()
  const mo = d.getMonth()
  const last = new Date(y, mo + 1, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  const startYmd = `${y}-${pad(mo + 1)}-01`
  const endYmd = `${y}-${pad(mo + 1)}-${pad(last)}`

  const { data: shifts, error } = await supabase
    .from('shifts')
    .select(
      'work_date, staff_id, shift_pattern_name, scheduled_start_at, scheduled_end_at'
    )
    .eq('store_id', session.store_id)
    .gte('work_date', startYmd)
    .lte('work_date', endYmd)

  if (error) return { ok: false, error: error.message }

  const staffIds = [...new Set((shifts ?? []).map((x) => x.staff_id))]
  const snMap = new Map<string, number>()
  if (staffIds.length) {
    const { data: staffRows } = await supabase
      .from('staffs')
      .select('staff_id, staff_number')
      .in('staff_id', staffIds)
    for (const r of staffRows ?? []) {
      snMap.set(r.staff_id, r.staff_number)
    }
  }

  const header =
    '#従業員コード,勤務日,パターンコード,出勤予定,退勤予定,出勤所属コード'
  const lines = [header]
  for (const s of shifts ?? []) {
    const num = snMap.get(s.staff_id) ?? ''
    const pat = s.shift_pattern_name ?? ''
    const start = formatJstHHmm(s.scheduled_start_at as string)
    const end = formatJstHHmm(s.scheduled_end_at as string)
    lines.push(`#${num},${s.work_date},${pat},${start},${end},${session.store_id}`)
  }
  lines.push('')

  return { ok: true, csv: lines.join('\n') }
}

export async function saveShiftFromMinutes(input: {
  work_date: string
  staff_id: string
  start_minutes: number
  end_minutes: number
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (input.end_minutes <= input.start_minutes) {
    return { ok: false, error: '終了は開始より後である必要があります' }
  }
  const startIso = workDateMinutesToIso(input.work_date, input.start_minutes)
  const endIso = workDateMinutesToIso(input.work_date, input.end_minutes)
  return upsertShiftTimes({
    work_date: input.work_date,
    staff_id: input.staff_id,
    scheduled_start_at: startIso,
    scheduled_end_at: endIso,
    shift_pattern_id: null,
    shift_pattern_name: null,
  })
}
