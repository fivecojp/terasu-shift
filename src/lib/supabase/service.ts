import { createClient } from '@supabase/supabase-js'

/**
 * RLS をバイパスして Supabase に接続するクライアント（サーバー専用）。
 * SUPABASE_SERVICE_ROLE_KEY はクライアントに含めないこと。
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
    )
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
