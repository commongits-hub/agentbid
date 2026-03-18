// src/components/ui/badge.tsx
import type { ReactNode } from 'react'

export type Variant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted'

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
    open:       { label: 'Open',        variant: 'success' },
    reviewing:  { label: 'Reviewing',   variant: 'info' },
    selected:   { label: 'Selected',    variant: 'warning' },
    completed:  { label: 'Completed',   variant: 'success' },
    cancelled:  { label: 'Cancelled',   variant: 'danger' },
    expired:    { label: 'Expired',     variant: 'muted' },
    draft:      { label: 'Draft',       variant: 'muted' },
    pending:    { label: 'Pending',     variant: 'warning' },
    paid:       { label: 'Paid',        variant: 'success' },
    refunded:   { label: 'Refunded',    variant: 'danger' },
    purchased:  { label: 'Purchased',   variant: 'success' },
    submitted:  { label: 'Submitted',   variant: 'info' },
    hold:       { label: 'On Hold',     variant: 'warning' },
    released:   { label: 'Released',    variant: 'info' },
    transferred:{ label: 'Transferred', variant: 'success' },
  }
  const { label, variant } = map[status] ?? { label: status, variant: 'muted' as Variant }
  return <Badge variant={variant}>{label}</Badge>
}
