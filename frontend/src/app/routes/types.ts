import type { ComponentType } from 'react'
export interface EntradaModulo {
  id: 'auth' | 'negocios' | 'roles' | 'membresias' | 'categorias' | 'productos' | 'existencias' | 'movimientos'
  label: string
  path: string
  Page: ComponentType
  ambito: 'publico' | 'plataforma' | 'negocio'
  permiso: string
  permisosAlternativos?: string[]
}
