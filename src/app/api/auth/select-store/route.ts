import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import {
  SESSION_COOKIE_NAME,
  decodeSessionToken,
  encodeSessionToken,
  homePathForRole,
} from '@/lib/session-token'

type Body = { store_id?: string }

export async function POST(request: Request) {
  let body: Body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const store_id = body.store_id?.trim()
  if (!store_id) {
    return NextResponse.json({ error: '店舗を選択してください' }, { status: 400 })
  }

  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })
  }

  const payload = await decodeSessionToken(token)
  if (!payload) {
    cookieStore.delete(SESSION_COOKIE_NAME)
    return NextResponse.json({ error: 'セッションが無効です' }, { status: 401 })
  }

  const allowed = payload.memberships.some((m) => m.store_id === store_id)
  if (!allowed) {
    return NextResponse.json({ error: '選択できない店舗です' }, { status: 403 })
  }

  const updated = await encodeSessionToken({
    ...payload,
    active_store_id: store_id,
  })

  cookieStore.set(SESSION_COOKIE_NAME, updated, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })

  const m = payload.memberships.find((x) => x.store_id === store_id)
  if (!m) {
    return NextResponse.json({ error: 'Internal' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    redirect: homePathForRole(m.role),
  })
}
