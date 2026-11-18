import type { Usuario } from '../usuarios/types'
import type { CrearNegocioSolicitud } from './types'

export interface ValoresNegocio {
  nombre: string
  tipo: string
  administrador: Usuario | null
}

export type ErroresNegocio = Partial<Record<'nombre' | 'tipo' | 'administrador_id', string[]>>

export function validarNegocio(valores: ValoresNegocio): ErroresNegocio {
  const errores: ErroresNegocio = {}
  if (!valores.nombre.trim()) errores.nombre = ['Escribe el nombre del negocio.']
  if (!valores.tipo.trim()) errores.tipo = ['Escribe el tipo de negocio.']
  const administrador = valores.administrador
  if (!administrador || !administrador.is_active || !Number.isInteger(administrador.id) || administrador.id <= 0) {
    errores.administrador_id = ['Selecciona una cuenta activa existente.']
  }
  return errores
}

export function aSolicitudNegocio(valores: ValoresNegocio): CrearNegocioSolicitud {
  const administrador = valores.administrador
  if (!administrador) throw new Error('El administrador es obligatorio.')
  return { nombre: valores.nombre.trim(), tipo: valores.tipo.trim(), administrador_id: administrador.id }
}
