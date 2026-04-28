'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { logoutAndRedirectToLogin } from '@/lib/logout-client'

type StoreOption = {
  store_id: string
  store_name: string
  role: 'general' | 'leader'
}

type FormProps = {
  stores: StoreOption[]
}

export function SelectStoreStaffFooter({ staffName }: { staffName: string }) {
  return (
    <div className="mt-4 text-center">
      <p className="text-xs text-zinc-400">{staffName} でログイン中</p>
      <button
        type="button"
        className="mt-1 text-xs text-zinc-400 underline hover:text-zinc-600"
        onClick={() => void logoutAndRedirectToLogin()}
      >
        ログアウト
      </button>
    </div>
  )
}

export function SelectStoreForm({ stores }: FormProps) {
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
    <div>
      <div>
        {stores.map((store, index) => (
          <button
            key={store.store_id}
            type="button"
            onClick={() => pick(store.store_id)}
            className={`flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-zinc-50 ${
              index !== stores.length - 1 ? 'border-b border-zinc-100' : ''
            } ${loadingId !== null && loadingId !== store.store_id ? 'pointer-events-none' : ''} ${
              loadingId === store.store_id ? 'opacity-50' : ''
            }`}
          >
            <span className="text-sm font-medium text-zinc-800">
              {store.store_name}
            </span>
            <span className="text-xs text-zinc-300" aria-hidden>
              ›
            </span>
          </button>
        ))}
      </div>

      {error ? (
        <p className="px-6 pb-4 pt-2 text-center text-xs text-rose-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
