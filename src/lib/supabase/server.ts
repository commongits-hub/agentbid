// src/lib/supabase/server.ts
// 서버 전용 Supabase 클라이언트 (service_role: RLS 우회)
// ⚠️ 절대로 클라이언트 컴포넌트에서 import 금지

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase server environment variables')
}

// service_role: RLS 우회, webhook 처리 / order 상태 변경 / payout 조회에만 사용
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
})

// 유저 JWT로 authenticated 클라이언트 생성 (RLS 적용)
export function createServerClientWithAuth(accessToken: string) {
  return createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: { persistSession: false },
  })
}
