import type { ButtonHTMLAttributes, ReactNode } from 'react'
type Props = ButtonHTMLAttributes<HTMLButtonElement> & { pending?: boolean; pendingLabel?: ReactNode }
export function Button({ pending = false, pendingLabel = 'Guardando…', disabled, children, type = 'button', ...props }: Props) {
  return <button {...props} type={type} disabled={disabled || pending} aria-busy={pending}>{pending ? pendingLabel : children}</button>
}
