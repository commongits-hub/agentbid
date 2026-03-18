'use client'

interface Props {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open, title, description,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  danger = false, onConfirm, onCancel,
}: Props) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-gray-50">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-gray-400">{description}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-xl border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:border-gray-500 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
              danger
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-emerald-500 text-gray-950 hover:bg-emerald-400'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
