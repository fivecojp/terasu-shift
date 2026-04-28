'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

type StoreOption = {
  store_id: string
  store_name: string
  role: 'general' | 'leader'
}

type Props = {
  stores: StoreOption[]
}

export function SelectStoreForm({ stores }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  async function pick(store_id: string) {
    setError(null)
    setLoadingId(store_id)
    try {
      const res = await fetch('/api/auth/select-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(
          typeof data.error === 'string' ? data.error : '店舗の選択に失敗しました'
        )
        setLoadingId(null)
        return
      }
      if (typeof data.redirect === 'string') {
        router.replace(data.redirect)
        router.refresh()
        return
      }
      router.replace('/request')
      router.refresh()
    } catch {
      setError('通信に失敗しました')
      setLoadingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600">
        所属店舗が複数あります。利用する店舗を選んでください。
      </p>
      <ul className="space-y-2">
        {stores.map((s) => (
          <li key={s.store_id}>
            <button
              type="button"
              disabled={loadingId !== null}
              onClick={() => pick(s.store_id)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-60"
            >
              <span className="font-medium text-zinc-900">{s.store_name}</span>
              <span className="shrink-0 text-xs text-zinc-500">
                {loadingId === s.store_id
                  ? '処理中…'
                  : s.role === 'leader'
                    ? 'リーダー'
                    : '一般'}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
