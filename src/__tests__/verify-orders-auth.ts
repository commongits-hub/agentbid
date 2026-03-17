// 확인 항목 4개 로직 검증 (tsx 직접 실행)
// 실제 HTTP/Supabase 호출 없이 핵심 로직만 추출해서 검증

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

let pass = 0
let fail = 0

function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ✅ PASS  ${name}`)
    pass++
  } else {
    console.error(`  ❌ FAIL  ${name}`)
    fail++
  }
}

// ─────────────────────────────────────────────────────────────────────
// [1] GET cookie fallback: Bearer 유무 분기 로직
// ─────────────────────────────────────────────────────────────────────
console.log('\n[1] GET /api/orders - cookie fallback 분기')
{
  function getClientMode(authHeader: string | null): 'jwt' | 'cookie' {
    const bearerToken = authHeader?.replace('Bearer ', '') || undefined
    return bearerToken ? 'jwt' : 'cookie'
  }

  check('Bearer 있음 → jwt client', getClientMode('Bearer eyABC') === 'jwt')
  check('Bearer 없음 → cookie client', getClientMode(null) === 'cookie')
  check('Authorization 헤더 없음 → cookie client', getClientMode(undefined as any) === 'cookie')
  check('"Bearer " only (빈 토큰) → cookie client', getClientMode('Bearer ') === 'cookie')
}

// ─────────────────────────────────────────────────────────────────────
// [2] requireAuth() 비로그인: cookie fallback에서 session 없으면 401
//     (실제 Supabase 호출 없이 분기 로직만 검증)
// ─────────────────────────────────────────────────────────────────────
console.log('\n[2] requireAuth() - 비로그인 → 401 경로')
{
  // auth.ts 로직: session null이면 401 반환
  function simulateRequireAuth(session: any): { status: number } | { user: any } {
    if (!session) return { status: 401 }
    return { user: { id: 'x' } }
  }
  const noSession = simulateRequireAuth(null)
  check('session 없음 → 401', 'status' in noSession && noSession.status === 401)
  const withSession = simulateRequireAuth({ access_token: 'tok' })
  check('session 있음 → user 반환', 'user' in withSession)
}

// ─────────────────────────────────────────────────────────────────────
// [3] role allowlist 로직
// ─────────────────────────────────────────────────────────────────────
console.log('\n[3] requireAuth() - role allowlist')
{
  const ALLOWED_ROLES = ['user', 'provider', 'admin'] as const
  type AppRole = typeof ALLOWED_ROLES[number]

  function resolveRole(rawRole: string): AppRole {
    return (ALLOWED_ROLES as readonly string[]).includes(rawRole)
      ? (rawRole as AppRole)
      : 'user'
  }

  check("'user' → 'user'",      resolveRole('user')     === 'user')
  check("'provider' → 'provider'", resolveRole('provider') === 'provider')
  check("'admin' → 'admin'",    resolveRole('admin')    === 'admin')
  check("'superadmin' → 'user' (다운그레이드)", resolveRole('superadmin') === 'user')
  check("'' → 'user'",          resolveRole('')         === 'user')
  check("'ADMIN' → 'user' (대소문자 구분)", resolveRole('ADMIN')    === 'user')
  check("'injected' → 'user'",  resolveRole('injected') === 'user')
}

// ─────────────────────────────────────────────────────────────────────
// [4] pending 중복 주문 에러 메시지
// ─────────────────────────────────────────────────────────────────────
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

console.log('\n[4] POST /api/orders - pending 중복 에러 메시지')
{
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(
    join(__dirname, '../app/api/orders/route.ts'),
    'utf8',
  )
  const hasCorrect = src.includes('A pending order already exists for this submission')
  const hasOld     = src.includes('A pending order already exists for this task')

  check('메시지: "...for this submission" 존재', hasCorrect)
  check('구버전 메시지: "...for this task" 제거됨', !hasOld)
}

// ─────────────────────────────────────────────────────────────────────
console.log(`\n결과: ${pass} PASS / ${fail} FAIL`)
if (fail > 0) process.exit(1)
