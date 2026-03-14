// src/lib/submission-shaper.ts
// submissions API 응답 필드 필터링 (핵심 보안 로직)
// DB 레벨에서 컬럼 마스킹이 없으므로 API 응답에서 강제 처리

import type { SubmissionRow, SubmissionPreview, SubmissionFull } from '@/types'

/**
 * submission row를 호출자 권한에 따라 필터링
 *
 * @param row      DB에서 가져온 원본 row
 * @param callerId    ⚠️ 현재 미사용 — 향후 provider 본인 접근 제어 등에 활용 가능
 * @param taskOwnerId ⚠️ 현재 미사용 — 향후 owner 전용 추가 필드 노출 시 사용 가능
 * @param hasPaid  callerId가 이 submission에 대한 paid order를 보유하는지
 *
 * 현재 접근 제어 기준: hasPaid 단일 조건
 * - true  → SubmissionFull 반환 (content_text, file_path 포함)
 * - false → SubmissionPreview 반환 (미리보기만)
 */
export function shapeSubmission(
  row: SubmissionRow,
  callerId: string,
  taskOwnerId: string,
  hasPaid: boolean,
): SubmissionPreview | SubmissionFull {
  // paid 상태인 경우에만 원본 전체 반환
  // ⚠️ provider 본인도 제출 후에는 preview만 반환 (API에서 별도 /submissions/mine 엔드포인트로 처리)
  const canSeeOriginal = hasPaid

  if (canSeeOriginal) {
    // SubmissionFull 반환
    return {
      id: row.id,
      task_id: row.task_id,
      agent_id: row.agent_id,
      status: row.status,
      quoted_price: row.quoted_price,
      preview_text: row.preview_text,
      preview_thumbnail_url: row.preview_thumbnail_url,
      content_text: row.content_text,
      file_path: row.file_path,
      file_name: row.file_name,
      file_size: row.file_size,
      mime_type: row.mime_type,
      created_at: row.created_at,
      updated_at: row.updated_at,
    } satisfies SubmissionFull
  }

  // task owner (미결제) → preview만 반환, content_text / file_path 제거
  return {
    id: row.id,
    task_id: row.task_id,
    agent_id: row.agent_id,
    status: row.status,
    quoted_price: row.quoted_price,
    preview_text: row.preview_text,
    preview_thumbnail_url: row.preview_thumbnail_url,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // content_text, file_path 의도적으로 제외
  } satisfies SubmissionPreview
}

/**
 * submissions 배열에 일괄 shaping 적용
 * 각 submission에 대해 paid 여부를 개별 확인
 */
export function shapeSubmissions(
  rows: SubmissionRow[],
  callerId: string,
  taskOwnerId: string,
  paidSubmissionIds: Set<string>,
): (SubmissionPreview | SubmissionFull)[] {
  return rows.map((row) =>
    shapeSubmission(row, callerId, taskOwnerId, paidSubmissionIds.has(row.id)),
  )
}
