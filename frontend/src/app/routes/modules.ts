import type { EntradaModulo } from './types'
import { AuthPage } from '../../features/auth/pages'
import { NegociosPage } from '../../features/negocios/pages'
import { RolesPage } from '../../features/roles/pages'
import { MembresiasPage } from '../../features/membresias/pages'
export const modules: EntradaModulo[] = [
  { id: 'auth', label: 'Acceso', path: '/', Page: AuthPage },
  { id: 'negocios', label: 'Plataforma', path: '/plataforma', Page: NegociosPage },
  { id: 'roles', label: 'Roles', path: '/negocio/roles', Page: RolesPage },
  { id: 'membresias', label: 'Membresías', path: '/negocio/membresias', Page: MembresiasPage },
]
