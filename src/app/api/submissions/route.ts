// src/app/api/submissions/route.ts
// GET  /api/submissions?task_id=uuid  - task의 submission 목록 조회
// POST /api/submissions               - submission 등록 (provider 전용)
//
// ⚠️ content_text / file_path 마스킹 정책 (이중 방어):
//
//   [DB 레벨] submissions_safe view (migration 023):
//     - content 컬럼은 구매 완료 / 본인 submission / admin만 실제값 반환
//     - 클라이언트 직접 호출도 view를 통해 자동 마스킹
//     - security_invoker = true → 기존 RLS 그대로 적용
//
//   [API 레벨] 2-query 분리 (추가 효율화):
//     - task owner:
//         Query 1: submissions_safe → PREVIEW 컬럼 (전체 submission, content 없음)
//         Query 2: submissions (service_role) → FULL 컬럼 (paid submission만)
//         Merge: paid → full row, 미결제 → preview row
//         → 미결제 submission content는 서버 메모리에도 올라오지 않음
//     - provider: submissions_safe → FULL (본인 submission, view에서 자동 공개)
//     - 그 외: 403

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireProvider } from '@/middleware/auth'
import { supabaseAdmin, createServerClientWithAuth } from '@/lib/supabase/server'
import type { SubmissionRow, SubmissionPreview } from '@/types'

// ── projection 상수 ────────────────────────────────────────────────────────────
const SUBMISSION_PREVIEW_COLUMNS = [
  'id', 'task_id', 'agent_id', 'status', 'quoted_price',
  'preview_text', 'preview_thumbnail_url',
  'created_at', 'updated_at',
].join(', ')

const SUBMISSION_FULL_COLUMNS = [
  'id', 'task_id', 'agent_id', 'status', 'quoted_price',
  'preview_text', 'preview_thumbnail_url',
  'content_text', 'file_path', 'file_name', 'file_size', 'mime_type',
  'created_at', 'updated_at',
].join(', ')

// ── 허용 MIME 타입 allowlist ────────────────────────────────────────────────────
const ALLOWED_MIME_TYPES = new Set([
  'text/plain', 'text/markdown', 'text/html', 'text/csv',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/zip', 'application/x-zip-compressed',
])

const MAX_FILE_SIZE    = 100 * 1024 * 1024 // 100MB
const MAX_CONTENT_TEXT = 50_000            // 50,000자
const MAX_FILE_NAME    = 255               // 파일명 최대 길이

// file_path 안전 패턴: submissions/{uuid}/{safe-filename}
// 파일명 규칙:
//   - 첫 문자: 알파벳(대소문자) 또는 숫자 (점·대시·언더스코어 시작 차단 → '..' 차단)
//   - 나머지: 알파벳, 숫자, 점, 대시, 언더스코어
//   - 전체 길이: 1–255자
// 차단: '..' traversal, '.hidden' 형태, 제어문자, 슬래시, 공백, 특수문자
const FILE_PATH_PATTERN = /^submissions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/submissions?task_id=uuid
// ──────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('error' in auth) return auth.error

  const taskId = req.nextUrl.searchParams.get('task_id')
  if (!taskId) {
    return NextResponse.json({ error: 'task_id is required' }, { status: 400 })
  }

  const supabase = createServerClientWithAuth(
    req.headers.get('authorization')?.replace('Bearer ', '') ?? '',
  )

  // 1. task 존재 확인
  //    RLS로 접근 불가한 경우와 실제 없는 경우 모두 404로 처리 (의도적: 존재 여부 비노출)
  const { data: task } = await supabase
    .from('tasks')
    .select('id, user_id')   // status는 현재 접근 정책에 사용 안 함 → 제외
    .eq('id', taskId)
    .single()

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  const isTaskOwner = task.user_id === auth.user.id

  // ── Case A: task owner ─────────────────────────────────────────────────────
  if (isTaskOwner) {
    // Query 1: 전체 submission → PREVIEW 컬럼만 fetch (content 없음)
    // submissions_safe: DB 레벨 마스킹 적용 (migration 023)
    // PREVIEW_COLUMNS만 select → content 컬럼 자체를 fetch하지 않음 (추가 방어)
    const { data: previewRows, error: listError } = await supabase
      .from('submissions_safe')
      .select(SUBMISSION_PREVIEW_COLUMNS)
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })

    if (listError) {
      return NextResponse.json({ error: listError.message }, { status: 500 })
    }

    // paid submission ID 조회 (service_role)
    const { data: paidOrders } = await supabaseAdmin
      .from('orders')
      .select('submission_id')
      .eq('task_id', taskId)
      .eq('user_id', auth.user.id)
      .eq('status', 'paid')

    const paidSubmissionIds = new Set(
      (paidOrders ?? []).map((o: any) => o.submission_id as string),
    )

    // Query 2: paid submission만 → FULL 컬럼 fetch (content 포함)
    // 미결제 submission의 content는 서버 메모리에도 올라오지 않음
    let paidContentMap = new Map<string, SubmissionRow>()
    if (paidSubmissionIds.size > 0) {
      const { data: paidFullRows } = await supabaseAdmin
        .from('submissions')
        .select(SUBMISSION_FULL_COLUMNS)
        .in('id', Array.from(paidSubmissionIds))
        .eq('task_id', taskId)           // 추가 안전 검증
        .is('soft_deleted_at', null)

      for (const row of (paidFullRows ?? []) as unknown as SubmissionRow[]) {
        paidContentMap.set(row.id, row)
      }
    }

    // 병합: paid는 full row, 미결제는 preview row
    const shaped = (previewRows ?? []).map((row: any) =>
      paidContentMap.has(row.id) ? paidContentMap.get(row.id)! : row,
    )

    return NextResponse.json({ data: shaped })
  }

  // ── Case B: provider — 본인 submission만 조회 ─────────────────────────────
  if (auth.user.role === 'provider') {
    // agent 조회: user_id = auth.user.id 명시 (RLS 의존 금지)
    const { data: agent } = await supabase
      .from('agents')
      .select('id')
      .eq('user_id', auth.user.id)
      .is('soft_deleted_at', null)
      .maybeSingle()

    if (!agent) {
      return NextResponse.json({ error: 'No agent found for this provider' }, { status: 403 })
    }

    // provider는 본인 작성물에 한해 full content 허용
    // submissions_safe: DB 레벨 마스킹 적용 (agent_id = get_my_agent_id() → can_see_full = true)
    const { data: rows, error } = await supabase
      .from('submissions_safe')
      .select(SUBMISSION_FULL_COLUMNS)
      .eq('task_id', taskId)
      .eq('agent_id', agent.id)    // 본인 submission만 (RLS + view 이중 검증)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data: rows ?? [] })
  }

  // ── Case C: 그 외 → 403 ───────────────────────────────────────────────────
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/submissions
// ──────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireProvider(req)
  if ('error' in auth) return auth.error

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const {
    task_id,
    quoted_price: rawPrice,
    preview_text: rawPreview,
    content_text: rawContent,
    file_path,
    file_name,
    file_size: rawFileSize,
    mime_type,
  } = body

  // ── 1. task_id ────────────────────────────────────────────────────────────
  if (!task_id || typeof task_id !== 'string') {
    return NextResponse.json({ error: 'task_id is required' }, { status: 400 })
  }

  // ── 2. quoted_price: number 타입 강제 + 정수 강제 ─────────────────────────
  if (typeof rawPrice !== 'number') {
    return NextResponse.json(
      { error: 'quoted_price must be a number' },
      { status: 400 },
    )
  }
  const quoted_price = Math.floor(rawPrice)
  if (!Number.isFinite(quoted_price) || quoted_price !== rawPrice) {
    return NextResponse.json(
      { error: 'quoted_price must be an integer' },
      { status: 400 },
    )
  }
  if (quoted_price < 1000 || quoted_price > 10_000_000) {
    return NextResponse.json(
      { error: 'quoted_price must be between 1000 and 10000000' },
      { status: 400 },
    )
  }

  // ── 3. preview_text: 정규화 ──────────────────────────────────────────────
  const preview_text = typeof rawPreview === 'string'
    ? rawPreview.replace(/\s+/g, ' ').trim().slice(0, 200)
    : null

  if (!preview_text || preview_text.length < 10) {
    return NextResponse.json(
      { error: 'preview_text must be at least 10 characters' },
      { status: 400 },
    )
  }

  // ── 4. content_text: 길이 상한 ───────────────────────────────────────────
  const content_text = typeof rawContent === 'string' && rawContent.trim().length > 0
    ? rawContent.trim()
    : null

  if (content_text && content_text.length > MAX_CONTENT_TEXT) {
    return NextResponse.json(
      { error: `content_text must not exceed ${MAX_CONTENT_TEXT} characters` },
      { status: 400 },
    )
  }

  // ── 5. file 메타데이터 일관성 검증 ──────────────────────────────────────
  // file_path가 있으면 file_name / mime_type / file_size도 필수
  const hasFile = file_path !== undefined && file_path !== null
  if (hasFile) {
    if (!file_name)     return NextResponse.json({ error: 'file_name is required when file_path is set' }, { status: 400 })
    if (!mime_type)     return NextResponse.json({ error: 'mime_type is required when file_path is set' }, { status: 400 })
    if (rawFileSize == null) return NextResponse.json({ error: 'file_size is required when file_path is set' }, { status: 400 })
  }

  // file 없이 mime_type/file_size만 보내는 경우 방지
  if (!hasFile && (mime_type || rawFileSize != null || file_name)) {
    return NextResponse.json(
      { error: 'file metadata (file_name/mime_type/file_size) requires file_path' },
      { status: 400 },
    )
  }

  // ── 6. content 최소 요건 ─────────────────────────────────────────────────
  // 허용 조합:
  //   text-only:  content_text 있음, file_path 없음
  //   file-only:  file_path 있음, content_text 없음
  //   text+file:  둘 다 있음 (파일 + 설명 텍스트 동시 제출)
  // 금지: 둘 다 없음 (preview_text만 있는 제출은 불허)
  if (!content_text && !hasFile) {
    return NextResponse.json(
      { error: 'Either content_text or file_path is required' },
      { status: 400 },
    )
  }

  // ── 7. file_path 패턴 검증 ───────────────────────────────────────────────
  let validatedFilePath: string | null = null
  let validatedFileName: string | null = null
  let validatedMimeType: string | null = null
  let validatedFileSize: number | null = null

  if (hasFile) {
    if (typeof file_path !== 'string' || !FILE_PATH_PATTERN.test(file_path)) {
      return NextResponse.json(
        { error: 'Invalid file_path format. Must be: submissions/{uuid}/{filename}' },
        { status: 400 },
      )
    }
    validatedFilePath = file_path

    // file_name 검증
    if (typeof file_name !== 'string') {
      return NextResponse.json({ error: 'file_name must be a string' }, { status: 400 })
    }
    const trimmedFileName = file_name.trim()
    if (trimmedFileName.length === 0 || trimmedFileName.length > MAX_FILE_NAME) {
      return NextResponse.json(
        { error: `file_name must be 1–${MAX_FILE_NAME} characters` },
        { status: 400 },
      )
    }
    // 제어문자 + 경로 구분자 차단
    if (/[\0\\/\r\n\t]/.test(trimmedFileName)) {
      return NextResponse.json(
        { error: 'file_name contains invalid characters' },
        { status: 400 },
      )
    }
    validatedFileName = trimmedFileName

    // mime_type 검증
    if (typeof mime_type !== 'string') {
      return NextResponse.json({ error: 'mime_type must be a string' }, { status: 400 })
    }
    if (!ALLOWED_MIME_TYPES.has(mime_type)) {
      return NextResponse.json(
        { error: `Unsupported mime_type: ${mime_type}` },
        { status: 400 },
      )
    }
    validatedMimeType = mime_type

    // file_size 검증: 양의 정수
    const fileSize = Number(rawFileSize)
    if (!Number.isFinite(fileSize) || !Number.isInteger(fileSize) || fileSize <= 0) {
      return NextResponse.json(
        { error: 'file_size must be a positive integer' },
        { status: 400 },
      )
    }
    if (fileSize > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `file_size must not exceed ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 },
      )
    }
    validatedFileSize = fileSize
  }

  // ── 8. agent 조회: user_id = auth.user.id 명시 ───────────────────────────
  const supabase = createServerClientWithAuth(
    req.headers.get('authorization')?.replace('Bearer ', '') ?? '',
  )

  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('id')
    .eq('user_id', auth.user.id)   // 명시적 소유권 검증 (RLS 의존 금지)
    .is('soft_deleted_at', null)
    .maybeSingle()

  if (agentError || !agent) {
    return NextResponse.json({ error: 'No agent found for this provider' }, { status: 403 })
  }

  // ── 9. task 유효성 검증 ───────────────────────────────────────────────────
  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .select('id, user_id, status')
    .eq('id', task_id)
    .single()

  if (taskError || !task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  if (task.status !== 'open') {
    return NextResponse.json(
      { error: 'Task is not accepting submissions' },
      { status: 422 },
    )
  }

  // 자기 own task 제출 방지 (DB trigger와 이중 방어)
  if (task.user_id === auth.user.id) {
    return NextResponse.json(
      { error: 'Cannot submit to your own task' },
      { status: 422 },
    )
  }

  // ── 10. submission 등록 ───────────────────────────────────────────────────
  const { data, error } = await supabase
    .from('submissions')
    .insert({
      task_id,
      agent_id:     agent.id,
      quoted_price,
      preview_text,
      content_text,
      file_path:    validatedFilePath,
      file_name:    validatedFileName,
      file_size:    validatedFileSize,
      mime_type:    validatedMimeType,
      status: 'submitted',
    })
    .select('id, task_id, agent_id, status, quoted_price, preview_text, created_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'You have already submitted to this task' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ✅ 응답: content_text / file_path 제외
  return NextResponse.json({ data }, { status: 201 })
}
