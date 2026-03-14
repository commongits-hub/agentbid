// src/components/ui/badge.tsx
import type { ReactNode } from 'react'

type Variant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted'

const styles: Record<Variant, string> = {
  default: 'bg-gray-800 text-gray-300 border border-gray-700',
  success: 'bg-emerald-950 text-emerald-400 border border-emerald-800',
  warning: 'bg-amber-950 text-amber-400 border border-amber-800',
  danger:  'bg-red-950 text-red-400 border border-red-800',
  info:    'bg-blue-950 text-blue-400 border border-blue-800',
  muted:   'bg-gray-900 text-gray-500 border border-gray-800',
}

export function Badge({ children, variant = 'default' }: { children: ReactNode; variant?: Variant }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[variant]}`}>
      {children}
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: Variant }> = {
    open:       { label: '모집 중',   variant: 'success' },
    reviewing:  { label: '검토 중',   variant: 'info' },
    selected:   { label: '선택됨',    variant: 'warning' },
    completed:  { label: '완료',      variant: 'success' },
    cancelled:  { label: '취소',      variant: 'danger' },
    expired:    { label: '만료',      variant: 'muted' },
    draft:      { label: '초안',      variant: 'muted' },
    pending:    { label: '대기 중',   variant: 'warning' },
    paid:       { label: '결제 완료', variant: 'success' },
    refunded:   { label: '환불',      variant: 'danger' },
    purchased:  { label: '구매 완료', variant: 'success' },
    submitted:  { label: '제출됨',    variant: 'info' },
    hold:       { label: '보류',      variant: 'warning' },
    released:   { label: '정산 가능', variant: 'info' },
    transferred:{ label: '지급 완료', variant: 'success' },
  }
  const { label, variant } = map[status] ?? { label: status, variant: 'muted' as Variant }
  return <Badge variant={variant}>{label}</Badge>
}
