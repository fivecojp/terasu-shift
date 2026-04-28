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
    tone === 'sat'
      ? 'text-sm font-semibold text-sky-700'
      : tone === 'sunh'
        ? 'text-sm font-semibold text-rose-600'
        : 'text-sm font-semibold text-zinc-800'
  const wdClass =
    tone === 'sat'
      ? 'text-xs text-sky-500'
      : tone === 'sunh'
        ? 'text-xs text-rose-400'
        : 'text-xs text-zinc-400'

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

  const selectClass =
    'min-h-10 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-slate-400'
  const customSelectClass =
    'min-h-9 min-w-0 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-slate-400'

  return (
    <div className="flex items-center gap-3 border-b border-zinc-100 bg-white px-4 py-2">
      <div className="flex shrink-0 flex-col gap-0.5">
        <span className={dateNumClass}>{md}</span>
        <span className={wdClass}>{wdl}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <label className="sr-only" htmlFor={`req-${dateYmd}`}>
          {labelText}
        </label>
        <select
          id={`req-${dateYmd}`}
          className={selectClass}
          disabled={disabled}
          value={
            sel === 'custom' && !halfOpts.length
              ? patterns[0]
                ? `p:${patterns[0].shift_pattern_id}`
                : 'off'
              : sel
          }
          onChange={(e) => onSelectChange(e.target.value)}
        >
          <optgroup label="パターン">
            {patterns.length === 0 ? (
              <option value="_none" disabled>
                （パターン未登録）
              </option>
            ) : (
              patterns.map((p) => (
                <option
                  key={p.shift_pattern_id}
                  value={`p:${p.shift_pattern_id}`}
                >
                  {p.pattern_name}
                </option>
              ))
            )}
          </optgroup>
          <option value="free">F（終日）</option>
          <option value="off">×（休み）</option>
          <option value="custom" disabled={!halfOpts.length}>
            その他（時間入力）
          </option>
        </select>

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
