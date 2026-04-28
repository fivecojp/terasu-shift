import { cookies } from 'next/headers'
import {
  SESSION_COOKIE_NAME,
  decodeSessionToken,
  homePathForRole,
  type SessionPayload,
} from '@/lib/session-token'

export type SessionUser = {
  staff_id: string
  staff_name: string
  role: 'general' | 'leader'
  store_id: string
}

/** 店舗未選択など、業務ページに進めない状態のときは null */
export async function getSession(): Promise<SessionUser | null> {
  const payload = await getSessionPayload()
  if (!payload?.active_store_id) return null
  const m = payload.memberships.find(
    (x) => x.store_id === payload.active_store_id
  )
  if (!m) return null
  return {
    staff_id: payload.staff_id,
    staff_name: payload.staff_name,
    role: m.role,
    store_id: payload.active_store_id,
  }
}

/** JWT が有効なら店舗未選択でも中身を返す（店舗選択画面用） */
export async function getSessionPayload(): Promise<SessionPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null
  return decodeSessionToken(token)
}

/** セッションからトップ遷移先（店舗・ロール込み）を返す */
export function homePathFromPayload(payload: SessionPayload): string | null {
  if (!payload.active_store_id) return '/login/select-store'
  const m = payload.memberships.find((x) => x.store_id === payload.active_store_id)
  if (!m) return '/login'
  return homePathForRole(m.role)
}
