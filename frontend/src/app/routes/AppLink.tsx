import type { AnchorHTMLAttributes, MouseEvent } from 'react'
import { navegar } from './navigation'
export function AppLink({ href = '/', onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  function click(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || props.target === '_blank') return
    event.preventDefault()
    navegar(href)
  }
  return <a {...props} href={href} onClick={click} />
}
