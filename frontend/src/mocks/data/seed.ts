import type { Usuario } from '../../features/usuarios/types'
import type { Negocio } from '../../features/negocios/types'
import type { Permiso, Rol } from '../../features/roles/types'
import type { Membresia } from '../../features/membresias/types'
import { permisosFase2 } from './fase2'
export const globalCodes = ['listar_negocios', 'crear_negocio', 'listar_usuarios', 'crear_usuario']
export const businessCodes = ['listar_roles', 'crear_rol', 'listar_membresias', 'crear_membresia', 'asignar_rol', ...permisosFase2]
export function crearDatosIniciales() {
  const usuarios: Usuario[] = ['plataforma', 'admin_tienda', 'admin_ferreteria', 'compartido', 'existente', 'inactivo'].map((username, index) => ({ id: index + 1, username, is_active: username !== 'inactivo' }))
  const negocios: Negocio[] = [
    { id: 1, nombre: 'Tienda Central', tipo: 'tienda', activo: true },
    { id: 2, nombre: 'Ferretería Norte', tipo: 'ferretería', activo: true },
  ]
  const permisos: Permiso[] = [...globalCodes, ...businessCodes].map((codigo, index) => ({ id: index + 1, codigo, ambito: index < globalCodes.length ? 'plataforma' : 'negocio' }))
  const businessIds = permisos.filter((p) => p.ambito === 'negocio').map((p) => p.id)
  const roles: Rol[] = [
    { id: 1, nombre: 'Superadministrador', negocio_id: null, predefinido: true, permiso_ids: [1, 2, 3, 4] },
    { id: 2, nombre: 'Administrador de negocio', negocio_id: 1, predefinido: true, permiso_ids: [...businessIds] },
    { id: 3, nombre: 'Administrador de negocio', negocio_id: 2, predefinido: true, permiso_ids: [...businessIds] },
    { id: 4, nombre: 'Consulta', negocio_id: 1, predefinido: false, permiso_ids: [5, 7] },
    { id: 5, nombre: 'Sin permisos', negocio_id: 2, predefinido: false, permiso_ids: [] },
  ]
  const membresias: Membresia[] = [
    { id: 1, usuario: usuarios[1], negocio_id: 1, rol_id: 2, activo: true },
    { id: 2, usuario: usuarios[2], negocio_id: 2, rol_id: 3, activo: true },
    { id: 3, usuario: usuarios[3], negocio_id: 1, rol_id: 4, activo: true },
    { id: 4, usuario: usuarios[3], negocio_id: 2, rol_id: 5, activo: true },
  ]
  return { usuarios, negocios, permisos, roles, membresias }
}
