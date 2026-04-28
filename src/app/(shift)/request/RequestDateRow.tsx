'use client'

import type { ShiftPattern } from '@/types/database'
import { parseYmd } from '@/lib/shift-request-periods'
import { minutesToDisplay } from '@/lib/time'

export type Tone = 'sat' | 'sunh' | 'plain'

export type RowVals = {
  mode: 'pattern' | 'free' | 'off' | 'custom'
  patternId: string | null
  customStart: number | null
  customEnd: number | null
}

const WD = ['日', '月', '火', '水', '木', '金', '土'] as const

type Props = {
  dateYmd: string
  labelText: string
  tone: Tone
  patterns: ShiftPattern[]
  halfOpts: number[]
  disabled: boolean
  row: RowVals
  onChangeMode: (next: RowVals) => void
}

function selectValueFromRow(r: RowVals): string {
  if (r.mode === 'pattern' && r.patternId) return `p:${r.patternId}`
  if (r.mode === 'free') return 'free'
  if (r.mode === 'off') return 'off'
  return 'custom'
}

const BTN_ON =
  'rounded-md bg-slate-700 px-2.5 py-1 text-xs font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40'
const BTN_OFF =
  'rounded-md border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40'
const BTN_OFF_SEL =
  'rounded-md bg-rose-600 px-2.5 py-1 text-xs font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40'
const BTN_OFF_UNSEL =
  'rounded-md border border-zinc-200 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40'

export function RequestDateRow({
  dateYmd,
  labelText,
  tone,
  patterns,
  halfOpts,
  disabled,
  row,
  onChangeMode,
}: Props) {
  const d = parseYmd(dateYmd)
  const md = `${d.getMonth() + 1}/${d.getDate()}`
  const wdl = WD[d.getDay()]
  const dateNumClass =
    tone === 'sunh'
      ? 'text-sm font-semibold text-rose-600'
      : 'text-sm font-semibold text-zinc-900'
  const wdClass =
    tone === 'sunh' ? 'text-xs text-rose-500' : 'text-xs text-zinc-500'

  const sel = selectValueFromRow(row)

  function onSelectChange(v: string) {
    if (v.startsWith('p:')) {
      onChangeMode({
        mode: 'pattern',
        patternId: v.slice(2),
        customStart: null,
        customEnd: null,
      })
      return
    }
    if (v === 'free') {
      onChangeMode({
        mode: 'free',
        patternId: null,
        customStart: null,
        customEnd: null,
      })
      return
    }
    if (v === 'off') {
      onChangeMode({
        mode: 'off',
        patternId: null,
        customStart: null,
        customEnd: null,
      })
      return
    }
    onChangeMode({
      mode: 'custom',
      patternId: null,
      customStart: row.customStart ?? halfOpts[0] ?? null,
      customEnd: row.customEnd ?? halfOpts[Math.min(1, halfOpts.length - 1)] ?? null,
    })
  }

  const customSelectClass =
    'min-h-9 min-w-0 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <div className="flex items-center gap-3 border-b border-zinc-100 bg-white px-4 py-2">
      <div className="flex shrink-0 flex-col gap-0.5">
        <span className={dateNumClass}>{md}</span>
        <span className={wdClass}>{wdl}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div
          role="group"
          aria-label={labelText}
          className="flex flex-wrap gap-1.5"
        >
          {patterns.map((p) => {
            const active =
              row.mode === 'pattern' && row.patternId === p.shift_pattern_id
            return (
              <button
                key={p.shift_pattern_id}
                type="button"
                disabled={disabled}
                className={active ? BTN_ON : BTN_OFF}
                onClick={() => onSelectChange(`p:${p.shift_pattern_id}`)}
              >
                {p.pattern_name}
              </button>
            )
          })}
          <button
            type="button"
            disabled={disabled}
            className={sel === 'free' ? BTN_ON : BTN_OFF}
            onClick={() => onSelectChange('free')}
          >
            F（終日）
          </button>
          <button
            type="button"
            disabled={disabled}
            className={sel === 'off' ? BTN_OFF_SEL : BTN_OFF_UNSEL}
            onClick={() => onSelectChange('off')}
          >
            ×（休み）
          </button>
          <button
            type="button"
            disabled={disabled || !halfOpts.length}
            className={sel === 'custom' ? BTN_ON : BTN_OFF}
            onClick={() => onSelectChange('custom')}
          >
            その他（時間入力）
          </button>
        </div>

        {row.mode === 'custom' ? (
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={customSelectClass}
              disabled={disabled}
              value={row.customStart ?? ''}
              onChange={(e) =>
                onChangeMode({
                  ...row,
                  customStart:
                    e.target.value === '' ? null : Number(e.target.value),
                })
              }
            >
              {halfOpts.map((m) => (
                <option key={`s-${dateYmd}-${m}`} value={m}>
                  {minutesToDisplay(m)}
                </option>
              ))}
            </select>
            <span className="text-sm text-zinc-500">〜</span>
            <select
              className={customSelectClass}
              disabled={disabled}
              value={row.customEnd ?? ''}
              onChange={(e) =>
                onChangeMode({
                  ...row,
                  customEnd:
                    e.target.value === '' ? null : Number(e.target.value),
                })
              }
            >
              {halfOpts.map((m) => (
                <option key={`e-${dateYmd}-${m}`} value={m}>
                  {minutesToDisplay(m)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
    </div>
  )
}
