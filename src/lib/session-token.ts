import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

export const SESSION_COOKIE_NAME = 'terasu.session'

export type SessionMembership = {
  store_id: string
  role: 'general' | 'leader'
}

export type SessionPayload = {
  staff_id: string
  staff_name: string
  memberships: SessionMembership[]
  /** 単一店舗のときはログイン直後から設定。複数店のときは店舗選択後に設定 */
  active_store_id: string | null
}

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET must be set to a string of at least 32 characters')
  }
  return new TextEncoder().encode(secret)
}

export async function encodeSessionToken(payload: SessionPayload): Promise<string> {
  const secret = getSecret()
  const jwt = await new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret)
  return jwt
}

export async function decodeSessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const secret = getSecret()
    const { payload } = await jwtVerify(token, secret)
    const p = payload as unknown as SessionPayload
    if (
      typeof p.staff_id !== 'string' ||
      typeof p.staff_name !== 'string' ||
      !Array.isArray(p.memberships) ||
      (p.active_store_id !== null &&
        typeof p.active_store_id !== 'string')
    ) {
      return null
    }
    return p
  } catch {
    return null
  }
}

export function homePathForRole(role: 'general' | 'leader'): string {
  return role === 'leader' ? '/schedule' : '/request'
}
