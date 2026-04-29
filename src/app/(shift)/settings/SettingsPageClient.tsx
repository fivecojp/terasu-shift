'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SessionUser } from '@/lib/auth'
import {
  createShiftPatternAction,
  deactivateShiftPatternAction,
  updateShiftPatternAction,
  updateShowRequestsToGeneralAction,
  upsertShiftSettingsAction,
} from '@/app/(shift)/settings/actions'
import { MinuteSelect } from '@/app/(shift)/settings/MinuteSelect'
import { logoutAndRedirectToLogin } from '@/lib/logout-client'
import { minutesToDisplay } from '@/lib/time'
import type { ShiftPattern, ShiftSetting } from '@/types/database'

export type PatternEdit = {
  clientKey: string
  shift_pattern_id: string | null
  pattern_name: string
  start_minutes: number
  end_minutes: number
  display_order: number
  is_active: boolean
}

function fromPatterns(patterns: ShiftPattern[]): PatternEdit[] {
  return patterns.map((p) => ({
    clientKey: p.shift_pattern_id,
    shift_pattern_id: p.shift_pattern_id,
    pattern_name: p.pattern_name,
    start_minutes: p.start_minutes,
    end_minutes: p.end_minutes,
    display_order: p.display_order,
    is_active: p.is_active,
  }))
}

type Props = {
  session: SessionUser
  settings: ShiftSetting
  showRequestsToGeneral: boolean
  patterns: ShiftPattern[]
  scheduleLinkYm: string
}

export function SettingsPageClient({
  session,
  settings: initialSettings,
  showRequestsToGeneral: showRequestsToGeneralProp,
  patterns,
  scheduleLinkYm,
}: Props) {
  const router = useRouter()
  const [toast, setToast] = useState<string | null>(null)

  const [sett, setSett] = useState({
    gantt_start_minutes: initialSettings.gantt_start_minutes,
    gantt_end_minutes: initialSettings.gantt_end_minutes,
    shift_cycle: initialSettings.shift_cycle,
    week_start_day: initialSettings.week_start_day,
    deadline_type: initialSettings.deadline_type,
    deadline_value: initialSettings.deadline_value,
  })

  const [patternEdits, setPatternEdits] = useState<PatternEdit[]>(() =>
    fromPatterns(patterns)
  )

  const [showRequestsToGeneral, setShowRequestsToGeneral] = useState(
    showRequestsToGeneralProp
  )
  const [showRequestsPending, setShowRequestsPending] = useState(false)

  useEffect(() => {
    setShowRequestsToGeneral(showRequestsToGeneralProp)
  }, [showRequestsToGeneralProp])

  useEffect(() => {
    setPatternEdits(fromPatterns(patterns))
  }, [patterns])

  useEffect(() => {
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const notify = useCallback((msg: string) => setToast(msg), [])

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault()
    const res = await upsertShiftSettingsAction({
      store_id: session.store_id,
      gantt_start_minutes: sett.gantt_start_minutes,
      gantt_end_minutes: sett.gantt_end_minutes,
      shift_cycle: sett.shift_cycle,
      week_start_day: sett.week_start_day,
      deadline_type: sett.deadline_type,
      deadline_value: Math.max(1, Math.floor(Number(sett.deadline_value)) || 1),
      csv_format_type: initialSettings.csv_format_type,
      show_requests_to_general: showRequestsToGeneral,
    })
    if (!res.ok) {
      alert(res.error)
      return
    }
    notify('設定を保存しました')
    router.refresh()
  }

  function addPatternRow() {
    const maxOrder = patternEdits.reduce(
      (m, r) => Math.max(m, r.display_order),
      0
    )
    setPatternEdits((prev) => [
      ...prev,
      {
        clientKey: `new:${crypto.randomUUID()}`,
        shift_pattern_id: null,
        pattern_name: '新規パターン',
        start_minutes: 1080,
        end_minutes: 1320,
        display_order: maxOrder + 1,
        is_active: true,
      },
    ])
  }

  function updatePattern(ix: number, patch: Partial<PatternEdit>) {
    setPatternEdits((prev) =>
      prev.map((row, i) => (i === ix ? { ...row, ...patch } : row))
    )
  }

  async function savePatternRow(ix: number) {
    const r = patternEdits[ix]
    if (!r) return
    if (r.end_minutes <= r.start_minutes) {
      alert('終了時刻は開始時刻より後にしてください')
      return
    }

    if (r.shift_pattern_id === null) {
      const res = await createShiftPatternAction({
        pattern_name: r.pattern_name,
        start_minutes: r.start_minutes,
        end_minutes: r.end_minutes,
        display_order: r.display_order,
        is_active: r.is_active,
      })
      if (!res.ok) {
        alert(res.error)
        return
      }
      notify('パターンを追加しました')
    } else {
      const res = await updateShiftPatternAction({
        shift_pattern_id: r.shift_pattern_id,
        pattern_name: r.pattern_name,
        start_minutes: r.start_minutes,
        end_minutes: r.end_minutes,
        display_order: r.display_order,
        is_active: r.is_active,
      })
      if (!res.ok) {
        alert(res.error)
        return
      }
      notify('パターンを保存しました')
    }
    router.refresh()
  }

  async function onShowRequestsToGeneralChange(next: boolean) {
    setShowRequestsPending(true)
    const res = await updateShowRequestsToGeneralAction(
      session.store_id,
      next
    )
    setShowRequestsPending(false)
    if (res.error) {
      alert(res.error)
      return
    }
    setShowRequestsToGeneral(next)
    notify('希望シフトの表示設定を更新しました')
    router.refresh()
  }

  async function removePatternRow(ix: number) {
    const r = patternEdits[ix]
    if (!r) return
    if (r.shift_pattern_id === null) {
      setPatternEdits((prev) => prev.filter((_, i) => i !== ix))
      return
    }
    if (!confirm('このパターンを無効化しますか？（論理削除：有効フラグOFF）'))
      return
    const res = await deactivateShiftPatternAction(r.shift_pattern_id)
    if (!res.ok) {
      alert(res.error)
      return
    }
    notify('パターンを無効化しました')
    router.refresh()
  }

  const scheduleHref = `/schedule?ym=${scheduleLinkYm}`

  const inputSelectClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-slate-400'
  const inlineSelectClass =
    'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-slate-400'
  const minuteSelectClass = `min-h-10 ${inputSelectClass}`

  const cycleLabels = useMemo(
    () => ({
      weekly: 'weekly（毎週）',
      biweekly: 'biweekly（隔週）',
      semimonthly: 'semimonthly（半月）',
      monthly: 'monthly（毎月）',
    }),
    []
  )

  return (
    <div className="min-h-screen bg-zinc-50">
      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-zinc-900 px-5 py-3 text-sm text-white shadow-lg">
          {toast}
        </div>
      ) : null}

      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <Link
            href={scheduleHref}
            className="text-sm text-zinc-500 hover:text-zinc-800"
          >
            ← シフト作成へ戻る
          </Link>
          <button
            type="button"
            className="text-sm text-zinc-400 underline hover:text-zinc-600"
            onClick={() => void logoutAndRedirectToLogin()}
          >
            ログアウト
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-6 text-xl font-bold text-zinc-900">シフト設定</h1>

        <section className="mb-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            シフトパターン
          </h2>
          <p className="mb-4 text-sm text-zinc-500">
            削除は論理削除です（<code className="text-xs">is_active = false</code>
            ）。保存は行ごとに実行します。
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-zinc-500">
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider">
                    パターン名
                  </th>
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider">
                    開始
                  </th>
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider">
                    終了
                  </th>
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider">
                    表示順
                  </th>
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider">
                    有効
                  </th>
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {patternEdits.map((r, ix) => (
                  <tr key={r.clientKey} className="border-b border-zinc-100">
                    <td className="p-2 align-middle">
                      <input
                        type="text"
                        className={`min-w-[8rem] ${inputSelectClass}`}
                        value={r.pattern_name}
                        onChange={(e) =>
                          updatePattern(ix, { pattern_name: e.target.value })
                        }
                      />
                    </td>
                    <td className="p-2 align-middle">
                      <div className="flex flex-wrap items-center gap-1">
                        <MinuteSelect
                          className={minuteSelectClass}
                          value={r.start_minutes}
                          onChange={(m) => updatePattern(ix, { start_minutes: m })}
                        />
                        <span className="text-xs text-zinc-500">
                          {minutesToDisplay(r.start_minutes)}
                        </span>
                      </div>
                    </td>
                    <td className="p-2 align-middle">
                      <div className="flex flex-wrap items-center gap-1">
                        <MinuteSelect
                          className={minuteSelectClass}
                          value={r.end_minutes}
                          onChange={(m) => updatePattern(ix, { end_minutes: m })}
                        />
                        <span className="text-xs text-zinc-500">
                          {minutesToDisplay(r.end_minutes)}
                        </span>
                      </div>
                    </td>
                    <td className="p-2 align-middle">
                      <input
                        type="number"
                        min={0}
                        className="w-20 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
                        value={r.display_order}
                        onChange={(e) =>
                          updatePattern(ix, {
                            display_order: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </td>
                    <td className="p-2 align-middle">
                      <input
                        type="checkbox"
                        checked={r.is_active}
                        onChange={(e) =>
                          updatePattern(ix, { is_active: e.target.checked })
                        }
                      />
                    </td>
                    <td className="p-2 align-middle">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                          onClick={() => void savePatternRow(ix)}
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          className="text-xs text-rose-500 hover:underline"
                          onClick={() => void removePatternRow(ix)}
                        >
                          削除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="mt-4 rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            onClick={addPatternRow}
          >
            ＋ パターンを追加
          </button>
        </section>

        <form
          onSubmit={saveSettings}
          className="mb-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
        >
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            表示・締切・サイクル
          </h2>

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-zinc-800">
              ガントチャート表示時間
            </h3>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex flex-wrap items-center gap-2 text-sm text-zinc-700">
                開始
                <MinuteSelect
                  className={minuteSelectClass}
                  value={sett.gantt_start_minutes}
                  onChange={(m) =>
                    setSett((s) => ({ ...s, gantt_start_minutes: m }))
                  }
                />
              </label>
              <label className="flex flex-wrap items-center gap-2 text-sm text-zinc-700">
                終了
                <MinuteSelect
                  className={minuteSelectClass}
                  value={sett.gantt_end_minutes}
                  onChange={(m) =>
                    setSett((s) => ({ ...s, gantt_end_minutes: m }))
                  }
                />
              </label>
            </div>
          </div>

          <div className="mt-6 space-y-2">
            <h3 className="text-sm font-medium text-zinc-800">シフトサイクル</h3>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              {(
                ['weekly', 'biweekly', 'semimonthly', 'monthly'] as const
              ).map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm text-zinc-700">
                  <input
                    type="radio"
                    name="shift_cycle"
                    value={c}
                    checked={sett.shift_cycle === c}
                    onChange={() => setSett((s) => ({ ...s, shift_cycle: c }))}
                  />
                  <span>{cycleLabels[c]}</span>
                </label>
              ))}
            </div>
            <div className="mt-2 flex gap-4">
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="radio"
                  name="week_start"
                  checked={sett.week_start_day === 'mon'}
                  onChange={() =>
                    setSett((s) => ({ ...s, week_start_day: 'mon' }))
                  }
                />
                週は月曜始まり
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="radio"
                  name="week_start"
                  checked={sett.week_start_day === 'sun'}
                  onChange={() =>
                    setSett((s) => ({ ...s, week_start_day: 'sun' }))
                  }
                />
                週は日曜始まり
              </label>
            </div>
          </div>

          <div className="mt-6 space-y-2">
            <h3 className="text-sm font-medium text-zinc-800">
              希望シフト締切
            </h3>
            <div className="flex flex-wrap items-center gap-3">
              <select
                className={inlineSelectClass}
                value={sett.deadline_type}
                onChange={(e) =>
                  setSett((s) => ({
                    ...s,
                    deadline_type: e.target.value as ShiftSetting['deadline_type'],
                  }))
                }
              >
                <option value="days_before">日数（days_before）</option>
                <option value="weeks_before">週数（weeks_before）</option>
                <option value="months_before">月数（months_before）</option>
              </select>
              <label className="flex flex-wrap items-center gap-2 text-sm text-zinc-700">
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="w-24 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
                  value={sett.deadline_value}
                  onChange={(e) =>
                    setSett((s) => ({
                      ...s,
                      deadline_value: Number(e.target.value) || 1,
                    }))
                  }
                />
                <span className="text-zinc-500">
                  {sett.deadline_type === 'days_before' && '（例: 7 = 期間開始の7日前まで）'}
                  {sett.deadline_type === 'weeks_before' && '（例: 2 = 2週間前まで）'}
                  {sett.deadline_type === 'months_before' && '（例: 1 = 1か月前まで）'}
                </span>
              </label>
            </div>
          </div>

          <div className="pt-6">
            <button
              type="submit"
              className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              表示・サイクル・締切を保存
            </button>
          </div>
        </form>

        <section className="mb-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            一般スタッフへの希望シフト表示
          </h2>
          <p className="mb-4 text-sm text-zinc-500">
            オフにすると、一般権限のスタッフはシフト画面で他のスタッフの希望シフトを確認できなくなります。
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-3">
              <span className="relative inline-flex h-7 w-12 shrink-0 items-center">
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={showRequestsToGeneral}
                  className="peer sr-only"
                  checked={showRequestsToGeneral}
                  disabled={showRequestsPending}
                  onChange={(e) =>
                    void onShowRequestsToGeneralChange(e.target.checked)
                  }
                />
                <span
                  className="pointer-events-none absolute inset-0 rounded-full bg-zinc-300 transition peer-checked:bg-emerald-600 peer-focus-visible:ring-2 peer-focus-visible:ring-slate-400 peer-disabled:opacity-50"
                  aria-hidden
                />
                <span
                  className="pointer-events-none absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5"
                  aria-hidden
                />
              </span>
              <span className="text-sm font-medium text-zinc-800">
                {showRequestsToGeneral ? '表示する' : '表示しない'}
              </span>
            </label>
          </div>
        </section>
      </div>
    </div>
  )
}
