import type { ReactNode } from 'react'
export function Loading({ children = 'Cargando…' }: { children?: ReactNode }) { return <p role="status">{children}</p> }
export function EmptyState({ title = 'No hay resultados', children }: { title?: string; children?: ReactNode }) { return <section className="feedback"><h2>{title}</h2>{children}</section> }
export function ErrorMessage({ children }: { children: ReactNode }) { return <div className="feedback error" role="alert">{children}</div> }
export function AccessDenied() { return <ErrorMessage>No tienes permiso para acceder a esta sección.</ErrorMessage> }
