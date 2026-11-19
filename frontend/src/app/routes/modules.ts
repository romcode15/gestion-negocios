import type { EntradaModulo } from './types'
import { AuthPage } from '../../features/auth/pages'
import { NegociosPage } from '../../features/negocios/pages'
import { RolesPage } from '../../features/roles/pages'
import { MembresiasPage } from '../../features/membresias/pages'
export const modules: EntradaModulo[] = [
  { id: 'auth', label: 'Acceso', path: '/', Page: AuthPage, ambito: 'publico', permiso: '' },
  { id: 'negocios', label: 'Plataforma', path: '/plataforma', Page: NegociosPage, ambito: 'plataforma', permiso: 'listar_negocios',
    permisosAlternativos: ['listar_negocios', 'crear_negocio', 'listar_usuarios', 'crear_usuario'] },
  { id: 'roles', label: 'Roles', path: '/negocio/roles', Page: RolesPage, ambito: 'negocio', permiso: 'listar_roles',
    permisosAlternativos: ['listar_roles', 'crear_rol'] },
  { id: 'membresias', label: 'Membresías', path: '/negocio/membresias', Page: MembresiasPage, ambito: 'negocio', permiso: 'listar_membresias',
    permisosAlternativos: ['listar_membresias', 'crear_membresia', 'asignar_rol'] },
]
