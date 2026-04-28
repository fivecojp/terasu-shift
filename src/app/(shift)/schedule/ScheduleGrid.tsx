'use client'

import type { Shift, ShiftPattern, ShiftRequest } from '@/types/database'
import { formatShiftTimeRangeCompact } from '@/lib/jst-shift-time'
import { minutesToDisplay } from '@/lib/time'
import type { StaffRow } from '@/app/(shift)/schedule/types'

type Props = {
  staff: StaffRow[]
  columnDates: string[]
  holidays: Set<string>
  mode: 'request' | 'shift'
  patternsById: Map<string, ShiftPattern>
  shiftsKey: Map<string, Shift>
  requestsKey: Map<string, ShiftRequest>
  onPickCell: (workDate: string) => void
}

const WD = ['日', '月', '火', '水', '木', '金', '土'] as const

function labelDate(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return `${m}/${d}\n(${WD[dt.getDay()]})`
}

function requestLabel(
  r: ShiftRequest,
  patterns: Map<string, ShiftPattern>
): string {
  switch (r.request_type) {
    case 'pattern': {
      const p = r.shift_pattern_id
        ? patterns.get(r.shift_pattern_id)
        : undefined
      return p?.pattern_name ?? '-'
    }
    case 'free':
      return 'F'
    case 'off':
      return '×'
    case 'custom': {
      const a = r.custom_start_minutes ?? 0
      const b = r.custom_end_minutes ?? 0
      return `${minutesToDisplay(a)}-${minutesToDisplay(b)}`
    }
    default:
      return ''
  }
}

function requestShort(
  r: ShiftRequest,
  patterns: Map<string, ShiftPattern>
): string {
  if (r.request_type === 'free') return 'F'
  if (r.request_type === 'off') return '×'
  if (r.request_type === 'pattern') {
    return patterns.get(r.shift_pattern_id ?? '')?.pattern_name ?? '?'
  }
  return '他'
}

export function ScheduleGrid({
  staff,
  columnDates,
  holidays,
  mode,
  patternsById,
  shiftsKey,
  requestsKey,
  onPickCell,
}: Props) {
  return (
      <div className="relative overflow-x-auto rounded-lg border border-zinc-300 bg-white">
        <table className="min-w-[840px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50">
              <th className="sticky left-0 z-10 border-r border-zinc-200 bg-zinc-50 px-2 py-3 text-left font-medium text-zinc-800">
                スタッフ
              </th>
              {columnDates.map((d) => {
                const [y, mo, day] = d.split('-').map(Number)
                const dt = new Date(y, mo - 1, day)
                const dow = dt.getDay()
                const hol = holidays.has(d)
                const tone =
                  dow === 6
                    ? 'bg-sky-100'
                    : dow === 0 || hol
                      ? 'bg-rose-100'
                      : ''
                return (
                  <th
                    key={d}
                    className={`min-w-[92px] whitespace-pre-line border-l border-zinc-200 px-2 py-3 text-center font-medium text-zinc-800 ${tone}`}
                  >
                    {labelDate(d)}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.staff_id} className="border-b border-zinc-100">
                <td className="sticky left-0 z-10 border-r border-zinc-200 bg-white px-2 py-3 font-medium text-zinc-900">
                  {s.staff_name}
                </td>
                {columnDates.map((d) => {
                  const k = `${s.staff_id}|${d}`
                  const req = requestsKey.get(k)
                  const sh = shiftsKey.get(k)
                  const showReq = mode === 'request'
                  const bg =
                    showReq && req?.request_type === 'off'
                      ? 'bg-zinc-200'
                      : showReq && req?.request_type === 'free'
                        ? 'bg-rose-50'
                        : ''

                  return (
                    <td
                      key={`${s.staff_id}_${d}`}
                      className={`relative min-h-[48px] cursor-pointer border-l border-zinc-100 px-1 py-2 text-center align-middle ${bg}`}
                      onClick={() =>
                        mode === 'shift' ? onPickCell(d) : undefined
                      }
                      title={
                        showReq && req
                          ? `希望: ${requestLabel(req, patternsById)}`
                          : undefined
                      }
                    >
                      {showReq ? (
                        req ? (
                          <span className="text-[13px]">
                            {requestShort(req, patternsById)}
                          </span>
                        ) : null
                      ) : sh ? (
                        <span className="text-[13px]">
                          {sh.shift_pattern_name?.trim()
                            ? sh.shift_pattern_name
                            : formatShiftTimeRangeCompact(
                                sh.scheduled_start_at,
                                sh.scheduled_end_at,
                                d
                              )}
                        </span>
                      ) : null}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
  )
}
