import type { CambiarRolSolicitud, CrearMembresiaSolicitud } from './types'

export type ModoCuenta = 'nueva' | 'existente'

export interface ValoresMembresia {
  username: string
  password: string
  rol_id: number | null
  modo: ModoCuenta
}

export type ErroresMembresia = Partial<Record<'username' | 'password' | 'rol_id', string[]>>

function esId(valor: number | null): valor is number {
  return typeof valor === 'number' && Number.isInteger(valor) && valor > 0
}

export function validarMembresia(valores: ValoresMembresia): ErroresMembresia {
  const errores: ErroresMembresia = {}
  if (!valores.username.trim()) errores.username = ['Escribe el nombre de usuario.']
  if (valores.modo === 'nueva' && !valores.password) errores.password = ['Escribe una contraseña.']
  if (!esId(valores.rol_id)) errores.rol_id = ['Selecciona un rol del negocio activo.']
  return errores
}

// La cuenta existente no envía la clave: el contrato distingue los modos por
// la presencia de password, no por un campo adicional.
export function aSolicitudMembresia(valores: ValoresMembresia): CrearMembresiaSolicitud {
  const username = valores.username.trim()
  const rolId = valores.rol_id
  if (!esId(rolId)) throw new Error('El rol es obligatorio.')
  if (valores.modo === 'nueva') return { username, password: valores.password, rol_id: rolId }
  return { username, rol_id: rolId }
}

export function validarRol(rolId: number | null): string[] {
  return esId(rolId) ? [] : ['Selecciona un rol del negocio activo.']
}

export function aSolicitudCambioRol(rolId: number | null): CambiarRolSolicitud {
  if (!esId(rolId)) throw new Error('El rol es obligatorio.')
  return { rol_id: rolId }
}
