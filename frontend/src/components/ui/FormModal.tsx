import type { FormEventHandler } from 'react'
import { Modal } from './Modal'
import type { ModalProps } from './Modal'
import { Button } from './Button'
export interface FormModalProps extends Omit<ModalProps, 'busy'> {
  onSubmit: FormEventHandler<HTMLFormElement>
  pending?: boolean
  actionText: string
  pendingText?: string
  cancelText?: string
}
export function FormModal({ onSubmit, pending = false, actionText, pendingText = 'Guardando…', cancelText = 'Cancelar', children, ...modalProps }: FormModalProps) {
  return <Modal {...modalProps} busy={pending}>
    <form className="form-modal" noValidate aria-busy={pending} onSubmit={(event) => {
      event.preventDefault()
      if (!pending) onSubmit(event)
    }}>
      <fieldset className="form-modal-fields" disabled={pending}>{children}</fieldset>
      <footer className="modal-actions">
        <Button type="button" className="modal-cancel" disabled={pending} onClick={modalProps.onClose}>{cancelText}</Button>
        <Button type="submit" pending={pending} pendingLabel={pendingText}>{actionText}</Button>
      </footer>
    </form>
  </Modal>
}
