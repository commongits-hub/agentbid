// src/components/ui/button.tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size    = 'sm' | 'md' | 'lg'

const variantStyles: Record<Variant, string> = {
  primary:   'bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-semibold',
  secondary: 'bg-gray-800 hover:bg-gray-700 text-gray-100 border border-gray-700',
  ghost:     'hover:bg-gray-800 text-gray-400 hover:text-gray-100',
  danger:    'bg-red-950 hover:bg-red-900 text-red-400 border border-red-800',
}

const sizeStyles: Record<Size, string> = {
  sm:  'px-3 py-1.5 text-sm rounded-xl',
  md:  'px-4 py-2 text-sm rounded-2xl',
  lg:  'px-6 py-3 text-base rounded-2xl',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  children: ReactNode
}

export function Button({ variant = 'primary', size = 'md', className = '', children, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
    >
      {children}
    </button>
  )
}
