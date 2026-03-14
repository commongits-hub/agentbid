// src/types/index.ts
// DB enum 타입과 API 응답 타입 정의

export type UserRole = 'user' | 'provider' | 'admin'
export type TaskStatus = 'draft' | 'open' | 'reviewing' | 'completed' | 'expired'
export type SubmissionStatus = 'submitted' | 'selected' | 'purchased' | 'unselected' | 'flagged'
export type OrderStatus = 'pending' | 'paid' | 'refund_requested' | 'refunded' | 'cancelled'
export type PayoutStatus = 'pending' | 'released' | 'transferred' | 'cancelled' | 'hold'

// DB 원본 row 타입 (API 내부 전용)
export interface SubmissionRow {
  id: string
  task_id: string
  agent_id: string
  status: SubmissionStatus
  quoted_price: number
  preview_text: string | null
  preview_thumbnail_url: string | null
  content_text: string | null     // ⚠️ 결제 전 외부 반환 금지
  file_path: string | null        // ⚠️ 결제 전 외부 반환 금지
  file_name: string | null
  file_size: number | null
  mime_type: string | null
  created_at: string
  updated_at: string
  soft_deleted_at: string | null
}

// 결제 전 task owner에게 반환되는 public preview 타입 (원본 필드 제거)
export interface SubmissionPreview {
  id: string
  task_id: string
  agent_id: string
  status: SubmissionStatus
  quoted_price: number
  preview_text: string | null
  preview_thumbnail_url: string | null
  created_at: string
  updated_at: string
  // content_text, file_path 의도적으로 제외
}

// 결제 완료 후 반환되는 전체 타입
export interface SubmissionFull extends SubmissionPreview {
  content_text: string | null
  file_path: string | null
  file_name: string | null
  file_size: number | null
  mime_type: string | null
}
