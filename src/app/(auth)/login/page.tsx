'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { FormEvent, useState } from 'react'

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [staffEmail, setStaffEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staff_email: staffEmail, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'ログインに失敗しました')
        setLoading(false)
        return
      }
      let target =
        typeof data.redirect === 'string' ? data.redirect : '/request'
      /* 複数店舗のときは必ず店舗選択へ。単一店舗のみ元のページへリダイレクト */
      if (
        target !== '/login/select-store'
      ) {
        const from = searchParams.get('from')
        if (
          from &&
          from.startsWith('/') &&
          !from.startsWith('//')
        ) {
          target = from
        }
      }
      router.replace(target)
      router.refresh()
    } catch {
      setError('通信に失敗しました')
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            TERASU-Shift
          </h1>
          <p className="mt-1 text-sm text-zinc-500">シフト管理システム</p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="staff_email"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-500"
                >
                  メールアドレス
                </label>
                <input
                  id="staff_email"
                  name="staff_email"
                  type="email"
                  autoComplete="email"
                  value={staffEmail}
                  onChange={(e) => setStaffEmail(e.target.value)}
                  required
                  className="w-full rounded-lg border border-zinc-300 px-4 py-3 text-sm text-zinc-800 placeholder:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="example@email.com"
                />
              </div>
              <div>
                <label
                  htmlFor="password"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-500"
                >
                  パスワード
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded-lg border border-zinc-300 px-4 py-3 text-sm text-zinc-800 placeholder:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-6 w-full rounded-lg bg-slate-700 py-3 text-sm font-semibold tracking-wide text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'ログイン中...' : 'ログイン'}
            </button>

            {error ? (
              <p className="mt-3 text-center text-xs text-rose-600" role="alert">
                {error}
              </p>
            ) : null}
          </form>
        </div>
      </div>
    </div>
  )
}
