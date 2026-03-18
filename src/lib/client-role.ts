import type { Session } from '@supabase/supabase-js'

/**
 * Read app_role from the client session.
 * Source of truth: JWT app_metadata.app_role (set by custom_access_token_hook).
 * Fallback to 'user' — no user_metadata.role fallback intentionally.
 * If app_role is missing, the server hook is not running correctly; surface the bug early.
 */
export function getClientRole(session: Session | null): string {
  if (!session) return 'user'
  return (session.user.app_metadata?.app_role ?? 'user') as string
}
