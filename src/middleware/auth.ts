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
  // [DEPRECATED] user_metadata.role fallback: 구버전 계정 호환용
  // custom_access_token_hook 도입 이후 신규 토큰은 모두 app_metadata.app_role을 포함함.
  // 제거 조건: legacy 계정 app_metadata 마이그레이션 완료 + 모든 active session 갱신(재로그인) 확인 후
  // 제거 위치: 아래 rawRole 라인의 `?? userMeta.role` 부분만 삭제하면 됨
  const userMeta   = authUser.user_metadata ?? {}

  // app_role 우선순위: JWT payload app_metadata (hook 주입) > user_metadata (구버전 fallback)
  // live 안정화 후: `?? userMeta.role` 제거하고 `?? 'user'`로 대체
  const ALLOWED_ROLES = ['user', 'provider', 'admin'] as const
  type AppRole = typeof ALLOWED_ROLES[number]

  const rawRole = (jwtAppMeta.app_role ?? userMeta.role ?? 'user') as string
  // role allowlist: 허용되지 않은 값이 JWT에 들어온 경우 'user'로 강제 다운그레이드
  // 보안 강화가 필요하면 'user' 대신 403 반환으로 교체 가능
  const role: AppRole = (ALLOWED_ROLES as readonly string[]).includes(rawRole)
    ? (rawRole as AppRole)
    : 'user'
  const isActive = jwtAppMeta.is_active ?? true

  if (isActive === false || isActive === 'false') {
    return { error: NextResponse.json({ error: 'Account deactivated' }, { status: 403 }) }
  }

  return {
    user: { id: authUser.id, email: authUser.email ?? '', role, is_active: Boolean(isActive) },
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
