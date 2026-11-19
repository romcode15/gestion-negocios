import { useId, useLayoutEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import './Modal.css'

export interface ModalProps {
  open: boolean
  title: string
  description?: string
  busy?: boolean
  onClose: () => void
  children: ReactNode
  initialFocusRef?: RefObject<HTMLElement | null>
}
let activeDialog: HTMLElement | null = null
function focusable(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex],[contenteditable="true"]')]
    .filter((element) => {
      if (element.tabIndex < 0 || element.matches(':disabled,input[type="hidden"]') || element.closest('[hidden],[inert]')) return false
      for (let parent: HTMLElement | null = element; parent && parent !== dialog; parent = parent.parentElement) {
        const style = getComputedStyle(parent)
        if (style.display === 'none' || style.visibility === 'hidden') return false
      }
      return true
    })
    .sort((a, b) => (a.tabIndex > 0 ? a.tabIndex : Infinity) - (b.tabIndex > 0 ? b.tabIndex : Infinity))
}
function OpenModal({ title, description, busy = false, onClose, children, initialFocusRef }: Omit<ModalProps, 'open'>) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const latest = useRef({ busy, onClose })
  const titleId = useId()
  const descriptionId = useId()
  useLayoutEffect(() => { latest.current = { busy, onClose } }, [busy, onClose])
  useLayoutEffect(() => {
    const dialog = dialogRef.current!
    const backdrop = backdropRef.current!
    if (activeDialog) throw new Error('No se permiten modales anidados o simultáneos.')
    activeDialog = dialog
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.getPropertyValue('overflow')
    const overflowPriority = document.body.style.getPropertyPriority('overflow')
    const inertNodes = new Map<Element, string | null>()
    function isolate() {
      for (const sibling of document.body.children) {
        if (sibling === backdrop || inertNodes.has(sibling)) continue
        inertNodes.set(sibling, sibling.getAttribute('inert'))
        sibling.setAttribute('inert', '')
      }
    }
    isolate()
    const observer = new MutationObserver(isolate)
    observer.observe(document.body, { childList: true })
    document.body.style.setProperty('overflow', 'hidden')
    function focusInside() {
      const preferred = initialFocusRef?.current
      if (preferred && dialog.contains(preferred) && focusable(dialog).includes(preferred)) preferred.focus()
      else (focusable(dialog)[0] ?? dialog).focus()
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!latest.current.busy) latest.current.onClose()
      }
      if (event.key !== 'Tab') return
      const controls = focusable(dialog)
      const first = controls[0], last = controls[controls.length - 1]
      if (!first) { event.preventDefault(); dialog.focus(); return }
      const current = document.activeElement
      if (event.shiftKey && (current === first || !controls.includes(current as HTMLElement))) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (current === last || !controls.includes(current as HTMLElement))) {
        event.preventDefault(); first.focus()
      }
    }
    function focusin(event: FocusEvent) {
      if (!dialog.contains(event.target as Node)) focusInside()
    }
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('focusin', focusin)
    focusInside()
    return () => {
      observer.disconnect()
      document.removeEventListener('keydown', keydown, true)
      document.removeEventListener('focusin', focusin)
      for (const [element, value] of inertNodes) {
        if (value === null) element.removeAttribute('inert')
        else element.setAttribute('inert', value)
      }
      if (overflow) document.body.style.setProperty('overflow', overflow, overflowPriority)
      else document.body.style.removeProperty('overflow')
      activeDialog = null
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [initialFocusRef])
  return createPortal(
    <div ref={backdropRef} className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div ref={dialogRef} className="modal-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined} aria-busy={busy} tabIndex={-1}>
        <header className="modal-header"><div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>
          <Button className="modal-close" disabled={busy} onClick={onClose} aria-label="Cerrar diálogo">×</Button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>, document.body,
  )
}
export function Modal({ open, ...props }: ModalProps) { return open ? <OpenModal {...props} /> : null }
