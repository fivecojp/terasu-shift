import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { ensureShiftSettingsForStore } from '@/lib/shift-settings-ensure'
import { createServiceClient } from '@/lib/supabase/service'
import { ymParamToTargetFirst } from '@/lib/shift-request-periods'
import type { ShiftPattern } from '@/types/database'
import { SettingsPageClient } from '@/app/(shift)/settings/SettingsPageClient'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'leader') redirect('/request')

  const sp = await searchParams
  const ymRaw = ymParamToTargetFirst(sp.ym ?? null)
  const ymForLink = ymRaw?.slice(0, 7) ?? new Date().toISOString().slice(0, 7)

  const ensured = await ensureShiftSettingsForStore(session.store_id)
  if (!ensured.ok) {
    return (
      <div className="p-8 text-sm text-red-700">
        シフト設定の初期化に失敗しました: {ensured.error}
      </div>
    )
  }
  const settings = ensured.settings

  const supabase = createServiceClient()

  const { data: patterns, error: pErr } = await supabase
    .from('shift_patterns')
    .select('*')
    .eq('store_id', session.store_id)
    .order('display_order', { ascending: true })

  if (pErr) {
    return (
      <div className="p-8 text-sm text-red-700">
        シフトパターンの取得に失敗しました: {pErr.message}
      </div>
    )
  }

  return (
    <SettingsPageClient
      session={session}
      settings={settings}
      patterns={(patterns ?? []) as ShiftPattern[]}
      scheduleLinkYm={ymForLink}
    />
  )
}
