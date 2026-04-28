import {
  formatYmd,
  lastDayOfMonth,
  listDatesInclusive,
  parseYmd,
} from '@/lib/shift-request-periods'

export type ViewSpan = '1w' | '2w' | 'half' | '1m'

/** 対象月（YYYY-MM-01）と表示幅から日付列を返す */
export function columnDatesForView(
  targetMonthFirst: string,
  span: ViewSpan
): string[] {
  const d = parseYmd(targetMonthFirst)
  const y = d.getFullYear()
  const m = d.getMonth()
  const last = lastDayOfMonth(y, m)
  const monthStart = formatYmd(new Date(y, m, 1))
  const monthEnd = formatYmd(new Date(y, m, last))

  switch (span) {
    case '1w': {
      const end = formatYmd(new Date(y, m, Math.min(7, last)))
      return listDatesInclusive(monthStart, end)
    }
    case '2w': {
      const end = formatYmd(new Date(y, m, Math.min(14, last)))
      return listDatesInclusive(monthStart, end)
    }
    case 'half': {
      const end = formatYmd(new Date(y, m, Math.min(15, last)))
      return listDatesInclusive(monthStart, end)
    }
    case '1m':
    default:
      return listDatesInclusive(monthStart, monthEnd)
  }
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
