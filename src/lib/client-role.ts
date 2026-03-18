import type { Session } from '@supabase/supabase-js'

/**
 * Read app_role from the client session by decoding the JWT payload directly.
 *
 * Why JWT decode instead of session.user.app_metadata:
 *   The Supabase JS SDK's session.user.app_metadata reflects raw_app_meta_data from the DB,
 *   which does NOT include values injected by custom_access_token_hook (only written to JWT).
 *   Decoding the JWT payload directly gives us the hook-injected app_role.
 *
 * Source of truth: JWT app_metadata.app_role
 * Fallback: 'user' — if app_role is missing, the server hook is not running correctly.
 */
function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(part))
  } catch {
    return {}
  }
}

export function getClientRole(session: Session | null): string {
  if (!session) return 'user'
  try {
    const payload = decodeJwtPayload(session.access_token)
    const appMeta = payload.app_metadata as Record<string, unknown> | undefined
    return (appMeta?.app_role as string) ?? 'user'
  } catch {
    return 'user'
  }
}
