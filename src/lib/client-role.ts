import type { Session } from '@supabase/supabase-js'

/**
 * 클라이언트 세션에서 app_role을 읽는 헬퍼.
 *
 * 주의: Supabase JS SDK `session.user.app_metadata`는 DB `raw_app_meta_data` 기준.
 * custom_access_token_hook은 JWT payload에만 app_role을 주입하므로 SDK 객체에는 포함되지 않음.
 *
 * 현재 구조:
 *   1. session.user.app_metadata.app_role  — hook이 raw_app_meta_data도 갱신할 경우 정상 반환
 *   2. session.user.user_metadata.role     — DEPRECATED: 구버전/hook 미적용 계정 호환 fallback
 *
 * TODO: session.access_token JWT payload 직접 디코딩으로 전환 후 fallback 제거
 * (server-side auth.ts의 decodeJwtPayload() 패턴 참고)
 */
export function getClientRole(session: Session | null): string {
  if (!session) return 'user'
  const appMeta = session.user.app_metadata ?? {}
  // DEPRECATED fallback — live 안정화 후 제거
  return (appMeta.app_role ?? session.user.user_metadata?.role ?? 'user') as string
}
