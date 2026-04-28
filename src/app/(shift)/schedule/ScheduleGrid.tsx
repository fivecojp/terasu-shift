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
  const scrollRef = useRef<HTMLDivElement>(null)
  const todayColIndex = columnDates.indexOf(todayStr)

  useEffect(() => {
    if (scrollRef.current === null || todayColIndex < 0) return
    const container = scrollRef.current
    const STAFF_COL_WIDTH = 128 // スタッフ列幅(px) 8rem想定
    const DATE_COL_WIDTH = 44 // 日付列幅(px) 2.75rem想定
    const todayLeft = STAFF_COL_WIDTH + todayColIndex * DATE_COL_WIDTH
    const containerWidth = container.clientWidth
    const targetScrollLeft = todayLeft - containerWidth / 2 + DATE_COL_WIDTH / 2
    container.scrollLeft = Math.max(0, targetScrollLeft)
  }, [columnDates, todayColIndex])

  return (
    <div ref={scrollRef} className="w-full overflow-x-auto rounded-lg border border-zinc-200 shadow-sm">
      <div className="w-full min-w-fit">
        <table
          className="w-full border-collapse text-sm"
          style={{
            minWidth: `${120 + columnDates.length * 44}px`,
            tableLayout: 'fixed',
          }}
        >
          <colgroup>
            <col style={{ width: '8rem', minWidth: '8rem', maxWidth: '12rem' }} />
            {columnDates.map((d) => (
              <col key={d} style={{ width: '2.75rem', minWidth: '2.75rem' }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                className="sticky left-0 top-0 z-30 border-b border-r border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-zinc-200"
                style={{ willChange: 'transform' }}
              >
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
                    className={`sticky top-0 z-20 border-b border-r border-zinc-100 bg-zinc-50 px-1 py-1.5 text-center text-xs font-medium whitespace-pre-line ${tone}`}
                    style={{ willChange: 'transform' }}
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
                  className={`sticky left-0 top-auto z-10 whitespace-nowrap border-b border-r border-zinc-200 px-3 py-2 text-sm font-medium shadow-[1px_0_0_0_#e4e4e7] ${
                    unsubmittedStaffIds.has(s.staff_id)
                      ? 'border-l-2 border-l-amber-400 bg-amber-50 text-amber-800'
                      : rowIdx % 2 === 1
                        ? 'bg-zinc-50/50 text-zinc-900'
                        : 'bg-white text-zinc-900'
                  }`}
                  style={{ willChange: 'transform' }}
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
                      className={`relative border-b border-r border-zinc-100 px-1 py-1 text-center align-middle text-xs ${
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
    </div>
  )
}
