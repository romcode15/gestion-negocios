import { useId } from 'react'
import type { InputHTMLAttributes } from 'react'
type Props = InputHTMLAttributes<HTMLInputElement> & { label: string; errors?: string[]; hint?: string }
export function TextField({ label, errors = [], hint, id, ...props }: Props) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const description = [props['aria-describedby'], hint ? fieldId + '-hint' : '', errors.length ? fieldId + '-errors' : ''].filter(Boolean).join(' ') || undefined
  return <div className="field">
    <label htmlFor={fieldId}>{label}</label>
    {hint && <small id={fieldId + '-hint'}>{hint}</small>}
    <input {...props} id={fieldId} aria-invalid={errors.length ? true : props['aria-invalid']} aria-describedby={description} />
    {errors.length > 0 && <ul className="field-errors" id={fieldId + '-errors'}>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul>}
  </div>
}
