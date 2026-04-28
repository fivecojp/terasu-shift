import { redirect } from 'next/navigation'
import { getSessionPayload } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { SelectStoreForm, SelectStoreStaffFooter } from './SelectStoreForm'

export default async function SelectStorePage() {
  const payload = await getSessionPayload()
  if (!payload) redirect('/login')
  // active_store_id がある場合も店舗切り替えのためこのページを表示する

  const ids = [...new Set(payload.memberships.map((m) => m.store_id))]
  const supabase = createServiceClient()
  const { data: rows } = await supabase
    .from('stores')
    .select('store_id, store_name')
    .in('store_id', ids)

  const nameById = new Map<string, string>(
    rows?.map((r) => [r.store_id, r.store_name?.trim() || '']) ?? []
  )

  const stores = payload.memberships.map((m) => ({
    store_id: m.store_id,
    role: m.role,
    store_name: nameById.get(m.store_id) || `店舗 (${m.store_id.slice(0, 8)}…)`,
  }))

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            TERASU-Shift
          </h1>
          <p className="mt-1 text-sm text-zinc-500">店舗を選択してください</p>
        </div>

        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-100 px-6 py-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              所属店舗
            </p>
          </div>
          <SelectStoreForm stores={stores} />
        </div>

        <SelectStoreStaffFooter staffName={payload.staff_name} />
      </div>
    </div>
  )
}
