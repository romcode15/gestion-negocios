import { useId } from 'react'
import type { SelectHTMLAttributes } from 'react'
type Props = SelectHTMLAttributes<HTMLSelectElement> & { label: string; errors?: string[] }
export function SelectField({ label, errors = [], id, children, ...props }: Props) {
  const generated = useId()
  const fieldId = id ?? generated
  const description = [props['aria-describedby'], errors.length ? fieldId + '-errors' : ''].filter(Boolean).join(' ') || undefined
  return <div className="field"><label htmlFor={fieldId}>{label}</label>
    <select {...props} id={fieldId} aria-invalid={errors.length ? true : props['aria-invalid']} aria-describedby={description}>{children}</select>
    {errors.length > 0 && <ul id={fieldId + '-errors'} className="field-errors">{errors.map((message, index) => <li key={index}>{message}</li>)}</ul>}
  </div>
}
