import type { CrearUsuarioSolicitud } from './types'

export interface ValoresUsuario {
  username: string
  password: string
}

export type ErroresUsuario = Partial<Record<keyof ValoresUsuario, string[]>>

export function validarUsuario(valores: ValoresUsuario): ErroresUsuario {
  const errores: ErroresUsuario = {}
  if (!valores.username.trim()) errores.username = ['Escribe un nombre de usuario.']
  if (!valores.password) errores.password = ['Escribe una contraseña.']
  return errores
}

export function aSolicitudUsuario(valores: ValoresUsuario): CrearUsuarioSolicitud {
  return { username: valores.username.trim(), password: valores.password }
}
