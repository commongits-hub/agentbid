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
 * JWT payload를 직접 디코딩 (서명 검증은 getUser()가 담당)
 * custom_access_token_hook이 JWT에 주입한 claims를 읽기 위해 필요.
 * getUser() 반환값의 app_metadata는 auth.users.raw_app_meta_data 기준이라
 * hook이 JWT에만 삽입한 app_role이 누락됨.
 */
function decodeJwtPayload(token: string): Record<string, any> {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(Buffer.from(part, 'base64').toString('utf8'))
  } catch {
    return {}
  }
}

/**
 * API route에서 현재 유저를 검증
 * - Bearer 헤더 우선, 없으면 Cookie fallback
 * - JWT payload에서 직접 app_metadata.app_role / is_active 추출
 *   (getUser() 반환값은 서명 검증 + user.id 획득용, claims는 JWT에서 직접 읽음)
 */
export async function requireAuth(
  req: NextRequest,
): Promise<{ user: AuthUser } | { error: NextResponse }> {
  const bearerToken = req.headers.get('authorization')?.replace('Bearer ', '') ?? ''

  let authUser: any = null
  let jwtPayload: Record<string, any> = {}

  if (bearerToken) {
    // Bearer 토큰: getUser()로 서명 검증 + user.id 획득
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${bearerToken}` } }, auth: { persistSession: false } },
    )
    const { data, error } = await supabase.auth.getUser(bearerToken)
    if (error || !data.user) {
      return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    }
    authUser   = data.user
    jwtPayload = decodeJwtPayload(bearerToken)
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
    authUser   = data.session.user
    jwtPayload = decodeJwtPayload(data.session.access_token)
  }

  // JWT payload에서 app_metadata 추출 (hook 주입 값 포함)
  // getUser().app_metadata는 raw_app_meta_data 기준 → hook 주입 app_role 미포함
  const jwtAppMeta = (jwtPayload.app_metadata as Record<string, any>) ?? {}
  const userMeta   = authUser.user_metadata ?? {}

  // app_role 우선순위: JWT payload app_metadata > user_metadata (구버전 계정 호환)
  const role     = (jwtAppMeta.app_role ?? userMeta.role ?? 'user') as 'user' | 'provider' | 'admin'
  const isActive = jwtAppMeta.is_active ?? true

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
