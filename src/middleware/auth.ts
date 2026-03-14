// src/middleware/auth.ts
// API route 인증 헬퍼
// Bearer 헤더 우선, 없으면 Cookie fallback

import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export type AuthUser = {
  id: string
  email: string
  role: 'user' | 'provider' | 'admin'
  is_active: boolean
}

/**
 * API route에서 현재 유저를 검증
 * - Bearer 헤더 우선, 없으면 Cookie fallback
 * - JWT claim에서 role, is_active 추출 (custom_access_token_hook 결과)
 */
export async function requireAuth(
  req: NextRequest,
): Promise<{ user: AuthUser } | { error: NextResponse }> {
  const bearerToken = req.headers.get('authorization')?.replace('Bearer ', '') ?? ''

  let authUser: any = null

  if (bearerToken) {
    // Bearer 토큰: getUser()로 서버 측 검증
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${bearerToken}` } }, auth: { persistSession: false } },
    )
    const { data, error } = await supabase.auth.getUser(bearerToken)
    if (error || !data.user) {
      return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    }
    authUser = data.user
  } else {
    // Cookie fallback
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cs) { cs.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) },
        },
      },
    )
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session) {
      return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    }
    authUser = data.session.user
  }

  // JWT custom claim에서 role, is_active 추출
  // app_role: hook이 삽입한 앱 레벨 role (user/provider/admin)
  // role 필드는 PostgREST용('authenticated') → 사용 안 함
  const appMeta  = authUser.app_metadata  ?? {}
  const userMeta = authUser.user_metadata ?? {}
  const role     = (appMeta.app_role ?? userMeta.app_role ?? userMeta.role ?? 'user') as 'user' | 'provider' | 'admin'
  const isActive = appMeta.is_active ?? userMeta.is_active ?? true

  if (isActive === false || isActive === 'false') {
    return { error: NextResponse.json({ error: 'Account deactivated' }, { status: 403 }) }
  }

  return {
    user: { id: authUser.id, email: authUser.email ?? '', role, is_active: true },
  }
}

/**
 * provider 역할 전용 API에서 사용
 */
export async function requireProvider(
  req: NextRequest,
): Promise<{ user: AuthUser } | { error: NextResponse }> {
  const result = await requireAuth(req)
  if ('error' in result) return result

  if (result.user.role !== 'provider' && result.user.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Provider role required' }, { status: 403 }) }
  }

  return result
}
