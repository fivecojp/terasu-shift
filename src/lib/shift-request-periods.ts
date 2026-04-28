import type { ShiftSetting } from '@/types/database'

/** DB shift_requests.period_type */
export type ShiftRequestPeriodType = 'first_half' | 'second_half' | 'full'

/** ローカル日付 YYYY-MM-DD */
export function formatYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function firstOfMonthFromYmd(ymd: string): string {
  const [y, m] = ymd.split('-').map(Number)
  return `${y}-${String(m).padStart(2, '0')}-01`
}

export function lastDayOfMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate()
}

export function weekStartsOnFromSettings(
  week_start_day: ShiftSetting['week_start_day']
): 0 | 1 {
  return week_start_day === 'sun' ? 0 : 1
}

/** 引数の日を含む週の開始日（weekStartsOn: 0=日, 1=月） */
export function startOfWeek(d: Date, weekStartsOn: 0 | 1): Date {
  const day = d.getDay()
  const diff =
    weekStartsOn === 1
      ? day === 0
        ? -6
        : 1 - day
      : -day
  const r = new Date(d)
  r.setDate(r.getDate() + diff)
  return r
}

export function endOfWeek(start: Date, weekStartsOn: 0 | 1): Date {
  const r = new Date(start)
  r.setDate(r.getDate() + 6)
  return r
}

export type WeekSlice = {
  id: string
  start: string
  end: string
  label: string
}

/** 対象月内にまたがる週ごとに区切り（端は月内でクリップ） */
export function listWeekSlicesInMonth(
  year: number,
  monthIndex: number,
  weekStartsOn: 0 | 1
): WeekSlice[] {
  const lastDayNum = lastDayOfMonth(year, monthIndex)
  const monthStart = new Date(year, monthIndex, 1)
  const monthLast = new Date(year, monthIndex, lastDayNum)
  let ws = startOfWeek(monthStart, weekStartsOn)
  const slices: WeekSlice[] = []

  while (ws.getTime() <= monthLast.getTime()) {
    const we = endOfWeek(ws, weekStartsOn)
    const clipStart = ws.getTime() < monthStart.getTime() ? monthStart : ws
    const clipEnd = we.getTime() > monthLast.getTime() ? monthLast : we
    if (clipStart.getTime() <= clipEnd.getTime()) {
      const s = formatYmd(clipStart)
      const e = formatYmd(clipEnd)
      slices.push({
        id: `w_${s}_${e}`,
        start: s,
        end: e,
        label: `${clipStart.getMonth() + 1}/${clipStart.getDate()}〜${clipEnd.getMonth() + 1}/${clipEnd.getDate()}`,
      })
    }
    const step = new Date(we.getTime())
    step.setDate(step.getDate() + 1)
    ws = startOfWeek(step, weekStartsOn)
  }

  const seen = new Set<string>()
  return slices.filter((x) => {
    const k = `${x.start}_${x.end}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export type BiweekSlice = {
  id: string
  start: string
  end: string
  label: string
}

export function pairBiweeklySlices(weeks: WeekSlice[]): BiweekSlice[] {
  const pairs: BiweekSlice[] = []
  for (let i = 0; i < weeks.length; i += 2) {
    const a = weeks[i]
    const b = weeks[i + 1]
    if (!a) break
    if (b) {
      pairs.push({
        id: `b_${a.start}_${b.end}`,
        start: a.start,
        end: b.end,
        label: `${a.label} × ${b.label}`,
      })
    } else {
      pairs.push({
        id: `b_${a.start}_${a.end}`,
        start: a.start,
        end: a.end,
        label: a.label,
      })
    }
  }
  return pairs
}

/** 両端含む連続日リスト */
export function listDatesInclusive(startYmd: string, endYmd: string): string[] {
  let d = parseYmd(startYmd)
  const end = parseYmd(endYmd)
  if (end.getTime() < d.getTime()) return []
  const out: string[] = []
  while (d.getTime() <= end.getTime()) {
    out.push(formatYmd(d))
    const n = new Date(d)
    n.setDate(n.getDate() + 1)
    d = n
  }
  return out
}

export type PeriodSel =
  | { kind: 'semimonthly'; phase: 'first_half' | 'second_half' }
  | { kind: 'monthly' }
  | { kind: 'weekly'; weekId: string }
  | { kind: 'biweekly'; biweekId: string }

/** 画面上の選択に対応する period_type と日付リスト */
export function resolveGridForSelection(
  targetMonthFirst: string,
  settings: ShiftSetting,
  sel: PeriodSel
): { period_type: ShiftRequestPeriodType; workDates: string[] } {
  const ym = parseYmd(targetMonthFirst)
  const y = ym.getFullYear()
  const m = ym.getMonth()
  const last = lastDayOfMonth(y, m)
  const wk = weekStartsOnFromSettings(settings.week_start_day)

  if (sel.kind === 'monthly') {
    const start = formatYmd(new Date(y, m, 1))
    const end = formatYmd(new Date(y, m, last))
    return {
      period_type: 'full',
      workDates: listDatesInclusive(start, end),
    }
  }

  if (sel.kind === 'semimonthly') {
    if (sel.phase === 'first_half') {
      const start = formatYmd(new Date(y, m, 1))
      const end = formatYmd(new Date(y, m, Math.min(15, last)))
      return {
        period_type: 'first_half',
        workDates: listDatesInclusive(start, end),
      }
    }
    const start = formatYmd(new Date(y, m, Math.min(16, last)))
    const end = formatYmd(new Date(y, m, last))
    return {
      period_type: 'second_half',
      workDates: listDatesInclusive(start, end),
    }
  }

  const weeks = listWeekSlicesInMonth(y, m, wk)
  if (sel.kind === 'weekly') {
    const w = weeks.find((x) => x.id === sel.weekId)
    const start = w?.start ?? formatYmd(new Date(y, m, 1))
    const end = w?.end ?? formatYmd(new Date(y, m, last))
    return {
      period_type: 'full',
      workDates: listDatesInclusive(start, end),
    }
  }

  const biweeks = pairBiweeklySlices(weeks)
  const bw = biweeks.find((x) => x.id === sel.biweekId)
  const start = bw?.start ?? formatYmd(new Date(y, m, 1))
  const end = bw?.end ?? formatYmd(new Date(y, m, last))
  return {
    period_type: 'full',
    workDates: listDatesInclusive(start, end),
  }
}

/**
 * 締切：対象「期間の最初の日」の手前にある提出期限日（カレンダー日）
 */
export function computeDeadlineYmd(
  settings: ShiftSetting,
  periodFirstDayYmd: string
): string {
  const d = parseYmd(periodFirstDayYmd)

  switch (settings.deadline_type) {
    case 'days_before':
      d.setDate(d.getDate() - settings.deadline_value)
      break
    case 'weeks_before':
      d.setDate(d.getDate() - 7 * settings.deadline_value)
      break
    case 'months_before':
      d.setMonth(d.getMonth() - settings.deadline_value)
      break
    default:
      break
  }

  return formatYmd(d)
}

/** 締切日が「今日より前」なら true（当日はまだ提出可とみなす） */
export function isDeadlineExpiredVsToday(
  deadlineYmd: string,
  todayYmd: string
): boolean {
  return deadlineYmd < todayYmd
}

export type PeriodDeadlineInfo = {
  sel: PeriodSel
  periodFirstYmd: string
  deadlineYmd: string
}

/** 対象月に存在する提出単位ごとの締切（computeDeadlineYmd の結果を利用） */
export function listPeriodsWithDeadlines(
  targetMonthFirst: string,
  settings: ShiftSetting
): PeriodDeadlineInfo[] {
  const ym = parseYmd(targetMonthFirst)
  const y = ym.getFullYear()
  const m = ym.getMonth()
  const wk = weekStartsOnFromSettings(settings.week_start_day)
  const weeks = listWeekSlicesInMonth(y, m, wk)
  const biweeks = pairBiweeklySlices(weeks)

  const out: PeriodDeadlineInfo[] = []

  const pushSel = (sel: PeriodSel): void => {
    const grid = resolveGridForSelection(targetMonthFirst, settings, sel)
    const periodFirst = grid.workDates[0]
    if (!periodFirst) return
    out.push({
      sel,
      periodFirstYmd: periodFirst,
      deadlineYmd: computeDeadlineYmd(settings, periodFirst),
    })
  }

  switch (settings.shift_cycle) {
    case 'monthly':
      pushSel({ kind: 'monthly' })
      break
    case 'semimonthly':
      pushSel({ kind: 'semimonthly', phase: 'first_half' })
      pushSel({ kind: 'semimonthly', phase: 'second_half' })
      break
    case 'weekly':
      for (const w of weeks) {
        pushSel({ kind: 'weekly', weekId: w.id })
      }
      break
    case 'biweekly':
      for (const bw of biweeks) {
        pushSel({ kind: 'biweekly', biweekId: bw.id })
      }
      break
    default:
      pushSel({ kind: 'monthly' })
      break
  }

  return out
}

export function periodSelEquals(a: PeriodSel, b: PeriodSel): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'monthly':
      return b.kind === 'monthly'
    case 'semimonthly':
      return b.kind === 'semimonthly' && a.phase === b.phase
    case 'weekly':
      return b.kind === 'weekly' && a.weekId === b.weekId
    case 'biweekly':
      return b.kind === 'biweekly' && a.biweekId === b.biweekId
    default:
      return false
  }
}

/** その月中に締切がまだ valid な提出単位が1つでもあるか */
export function monthHasAnyOpenPeriod(
  targetMonthFirst: string,
  settings: ShiftSetting,
  todayYmd: string
): boolean {
  return listPeriodsWithDeadlines(targetMonthFirst, settings).some(
    (p) => !isDeadlineExpiredVsToday(p.deadlineYmd, todayYmd)
  )
}

export function defaultTargetMonth(): string {
  const n = new Date()
  return formatYmd(new Date(n.getFullYear(), n.getMonth(), 1))
}

export function ymParamToTargetFirst(ym?: string | null): string | null {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return null
  return `${ym}-01`
}

export function monthRangeInclusive(targetMonthFirst: string): {
  startYmd: string
  endYmd: string
} {
  const d = parseYmd(targetMonthFirst)
  const y = d.getFullYear()
  const m = d.getMonth()
  const last = lastDayOfMonth(y, m)
  return {
    startYmd: formatYmd(new Date(y, m, 1)),
    endYmd: formatYmd(new Date(y, m, last)),
  }
}

export function listHalfHourOptions(start: number, end: number): number[] {
  const out: number[] = []
  for (let m = start; m <= end; m += 30) {
    out.push(m)
  }
  const lastPush = out[out.length - 1]
  if (lastPush !== undefined && lastPush < end && !out.includes(end)) {
    out.push(end)
  }
  return out
}
