import { redirect } from 'next/navigation'
import { getSessionPayload, homePathFromPayload } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { SelectStoreForm } from './SelectStoreForm'

export default async function SelectStorePage() {
  const payload = await getSessionPayload()
  if (!payload) redirect('/login')
  if (payload.active_store_id) {
    const path = homePathFromPayload(payload)
    redirect(path ?? '/login')
  }

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
    <div className="flex min-h-full flex-col items-center justify-center bg-zinc-50 px-4 py-12">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            店舗を選択
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            {payload.staff_name} さん
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
          <SelectStoreForm stores={stores} />
        </div>
      </div>
    </div>
  )
}
