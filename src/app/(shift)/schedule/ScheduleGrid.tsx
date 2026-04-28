'use client'

import { useEffect, useRef } from 'react'
import type { Shift, ShiftPattern, ShiftRequest } from '@/types/database'
import { formatShiftTimeRangeCompact } from '@/lib/jst-shift-time'
import { minutesToDisplay } from '@/lib/time'
import type { StaffRow } from '@/app/(shift)/schedule/types'

type Props = {
  staff: StaffRow[]
  columnDates: string[]
  holidays: Set<string>
  mode: 'request' | 'shift'
  role: 'general' | 'leader'
  patternsById: Map<string, ShiftPattern>
  shiftsKey: Map<string, Shift>
  requestsKey: Map<string, ShiftRequest>
  unsubmittedStaffIds: Set<string>
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
  role,
  patternsById,
  shiftsKey,
  requestsKey,
  unsubmittedStaffIds,
  onPickCell,
}: Props) {
  const todayStr = new Date().toLocaleDateString('sv-SE')
  const todayRef = useRef<HTMLTableCellElement>(null)

  useEffect(() => {
    if (todayRef.current) {
      todayRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      })
    }
  }, [])

  return (
    <div className="relative max-h-[min(75vh,960px)] overflow-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
      <table className="min-w-[840px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50">
            <th className="sticky left-0 top-0 z-[30] border-r border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-xs font-medium text-zinc-600">
              スタッフ
            </th>
            {columnDates.map((d) => {
              const [y, mo, day] = d.split('-').map(Number)
              const dt = new Date(y, mo - 1, day)
              const dow = dt.getDay()
              const hol = holidays.has(d)
              const isToday = d === todayStr
              const tone = isToday
                ? 'bg-slate-700 text-white font-bold'
                : dow === 6
                  ? 'bg-sky-50 text-sky-700'
                  : dow === 0 || hol
                    ? 'bg-rose-50 text-rose-600'
                    : 'bg-zinc-50 text-zinc-600'
              return (
                <th
                  key={d}
                  ref={isToday ? todayRef : undefined}
                  className={`sticky top-0 z-10 min-w-[92px] whitespace-pre-line border-r border-zinc-100 px-1 py-2 text-center text-xs font-medium ${tone}`}
                >
                  {labelDate(d)}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {staff.map((s, rowIdx) => (
            <tr
              key={s.staff_id}
              className={rowIdx % 2 === 1 ? 'bg-zinc-50/50' : 'bg-white'}
            >
              <td
                className={`sticky left-0 z-20 whitespace-nowrap border-r border-zinc-200 px-3 py-2 text-sm font-medium ${
                  unsubmittedStaffIds.has(s.staff_id)
                    ? 'border-l-2 border-l-amber-400 bg-amber-50 text-amber-800'
                    : rowIdx % 2 === 1
                      ? 'bg-zinc-50/50 text-zinc-900'
                      : 'bg-white text-zinc-900'
                }`}
              >
                {s.staff_name}
              </td>
              {columnDates.map((d) => {
                const k = `${s.staff_id}|${d}`
                const req = requestsKey.get(k)
                const sh = shiftsKey.get(k)
                const showReq = mode === 'request'
                const cellInteractive =
                  role === 'leader' && mode === 'shift'

                return (
                  <td
                    key={`${s.staff_id}_${d}`}
                    className={`relative min-h-[44px] border-b border-r border-zinc-100 px-1 py-1 text-center align-middle text-xs ${
                      cellInteractive
                        ? 'cursor-pointer hover:bg-zinc-50'
                        : 'cursor-default'
                    }`}
                    onClick={
                      cellInteractive ? () => onPickCell(d) : undefined
                    }
                    title={
                      showReq && req
                        ? `希望: ${requestLabel(req, patternsById)}`
                        : undefined
                    }
                  >
                    {showReq ? (
                      req ? (
                        req.request_type === 'free' ? (
                          <span className="inline-block rounded bg-pink-50 px-1 text-xs font-medium text-pink-600">
                            F
                          </span>
                        ) : req.request_type === 'off' ? (
                          <span className="text-xs text-zinc-400">×</span>
                        ) : (
                          <span className="text-xs text-zinc-500">
                            {requestShort(req, patternsById)}
                          </span>
                        )
                      ) : null
                    ) : sh ? (
                      <span
                        className={
                          sh.shift_pattern_name?.trim()
                            ? 'text-xs font-medium text-slate-700'
                            : 'text-xs text-slate-600'
                        }
                      >
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
