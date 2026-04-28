import {
  formatYmd,
  lastDayOfMonth,
  listDatesInclusive,
  parseYmd,
} from '@/lib/shift-request-periods'

export type ViewSpan = '1w' | '2w' | 'half' | '1m'

/** URL・calcViewRange 用（週次・隔週・半月・月次） */
export type ScheduleViewKind =
  | 'weekly'
  | 'biweekly'
  | 'semimonthly'
  | 'monthly'

export type ViewRange = {
  dates: string[]
  prevStart: string
  nextStart: string
  viewLabel: string
}

function addDaysYmd(ymd: string, deltaDays: number): string {
  const d = parseYmd(ymd)
  d.setDate(d.getDate() + deltaDays)
  return formatYmd(d)
}

function formatRangeLabelJa(startYmd: string, endYmd: string): string {
  const [y1, m1, d1] = startYmd.split('-').map(Number)
  const [y2, m2, d2] = endYmd.split('-').map(Number)
  if (y1 === y2 && m1 === m2) {
    return `${m1}/${d1}〜${m2}/${d2}`
  }
  return `${y1}/${m1}/${d1}〜${y2}/${m2}/${d2}`
}

export function viewSpanToKind(span: ViewSpan): ScheduleViewKind {
  switch (span) {
    case '1w':
      return 'weekly'
    case '2w':
      return 'biweekly'
    case 'half':
      return 'semimonthly'
    case '1m':
    default:
      return 'monthly'
  }
}

export function kindToViewSpan(kind: ScheduleViewKind): ViewSpan {
  switch (kind) {
    case 'weekly':
      return '1w'
    case 'biweekly':
      return '2w'
    case 'semimonthly':
      return 'half'
    case 'monthly':
    default:
      return '1m'
  }
}

export function parseScheduleViewKind(
  raw: string | string[] | undefined | null
): ScheduleViewKind | null {
  const v = Array.isArray(raw) ? raw[0] : raw
  if (!v || typeof v !== 'string') return null
  const map: Record<string, ScheduleViewKind> = {
    weekly: 'weekly',
    biweekly: 'biweekly',
    semimonthly: 'semimonthly',
    monthly: 'monthly',
    '1w': 'weekly',
    '2w': 'biweekly',
    half: 'semimonthly',
    '1m': 'monthly',
  }
  return map[v] ?? null
}

/** 期間に含まれる暦月の月初 YYYY-MM-01（重複なし・昇順） */
export function uniqueTargetMonthFirstsInRange(
  startYmd: string,
  endYmd: string
): string[] {
  const a = parseYmd(startYmd)
  const b = parseYmd(endYmd)
  if (b.getTime() < a.getTime()) return []
  const out: string[] = []
  let y = a.getFullYear()
  let m = a.getMonth()
  const endY = b.getFullYear()
  const endM = b.getMonth()
  while (y < endY || (y === endY && m <= endM)) {
    out.push(formatYmd(new Date(y, m, 1)))
    m++
    if (m > 11) {
      m = 0
      y++
    }
  }
  return out
}

export function buildSchedulePath(
  startYmd: string,
  kind: ScheduleViewKind
): string {
  return `/schedule?start=${encodeURIComponent(startYmd)}&view=${kind}`
}

export function calcViewRange(
  startStr: string,
  view: ScheduleViewKind
): ViewRange {
  const d0 = parseYmd(startStr)
  const y = d0.getFullYear()
  const mo = d0.getMonth()
  const day = d0.getDate()
  const last = lastDayOfMonth(y, mo)

  switch (view) {
    case 'monthly': {
      const start = formatYmd(new Date(y, mo, 1))
      const end = formatYmd(new Date(y, mo, last))
      const dates = listDatesInclusive(start, end)
      const prevStart = formatYmd(new Date(y, mo - 1, 1))
      const nextStart = formatYmd(new Date(y, mo + 1, 1))
      return {
        dates,
        prevStart,
        nextStart,
        viewLabel: `${y}年${mo + 1}月`,
      }
    }
    case 'semimonthly': {
      const inFirst = day <= 15
      const start = inFirst
        ? formatYmd(new Date(y, mo, 1))
        : formatYmd(new Date(y, mo, Math.min(16, last)))
      const end = inFirst
        ? formatYmd(new Date(y, mo, Math.min(15, last)))
        : formatYmd(new Date(y, mo, last))
      const dates = listDatesInclusive(start, end)
      let prevStart: string
      let nextStart: string
      if (inFirst) {
        const py = mo === 0 ? y - 1 : y
        const pm = mo === 0 ? 11 : mo - 1
        const pLast = lastDayOfMonth(py, pm)
        prevStart = formatYmd(new Date(py, pm, Math.min(16, pLast)))
        nextStart = formatYmd(new Date(y, mo, 16))
      } else {
        prevStart = formatYmd(new Date(y, mo, 1))
        nextStart = formatYmd(new Date(y, mo + 1, 1))
      }
      return {
        dates,
        prevStart,
        nextStart,
        viewLabel: formatRangeLabelJa(start, end),
      }
    }
    case 'weekly': {
      const end = addDaysYmd(startStr, 6)
      const dates = listDatesInclusive(startStr, end)
      return {
        dates,
        prevStart: addDaysYmd(startStr, -7),
        nextStart: addDaysYmd(startStr, 7),
        viewLabel: formatRangeLabelJa(startStr, end),
      }
    }
    case 'biweekly': {
      const end = addDaysYmd(startStr, 13)
      const dates = listDatesInclusive(startStr, end)
      return {
        dates,
        prevStart: addDaysYmd(startStr, -14),
        nextStart: addDaysYmd(startStr, 14),
        viewLabel: formatRangeLabelJa(startStr, end),
      }
    }
  }
}

/** 対象月（YYYY-MM-01）と表示幅から日付列を返す（開始日＝その月1日のときの互換用） */
export function columnDatesForView(
  targetMonthFirst: string,
  span: ViewSpan
): string[] {
  return calcViewRange(targetMonthFirst, viewSpanToKind(span)).dates
}

export function viewSpanLabel(span: ViewSpan): string {
  switch (span) {
    case '1w':
      return '1週間'
    case '2w':
      return '2週間'
    case 'half':
      return '半月'
    case '1m':
      return '1か月'
    default:
      return span
  }
}
