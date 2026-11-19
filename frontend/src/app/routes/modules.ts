import type { EntradaModulo } from './types'
import { AuthPage } from '../../features/auth/pages'
import { NegociosPage } from '../../features/negocios/pages'
import { RolesPage } from '../../features/roles/pages'
import { MembresiasPage } from '../../features/membresias/pages'
import { CategoriasPage } from '../../features/categorias/pages'
import { ProductosPage } from '../../features/productos/pages'
import { ExistenciasPage } from '../../features/existencias/pages'
import { MovimientosPage } from '../../features/movimientos/pages'
export const modules: EntradaModulo[] = [
  { id: 'categorias', label: 'Categorías', path: '/negocio/categorias', Page: CategoriasPage, ambito: 'negocio', permiso: 'listar_categorias',
    permisosAlternativos: ['listar_categorias', 'crear_categoria', 'editar_categoria'] },
  { id: 'productos', label: 'Productos', path: '/negocio/productos', Page: ProductosPage, ambito: 'negocio', permiso: 'listar_productos',
    permisosAlternativos: ['listar_productos', 'crear_producto', 'editar_producto'] },
  { id: 'existencias', label: 'Existencias', path: '/negocio/existencias', Page: ExistenciasPage, ambito: 'negocio', permiso: 'consultar_existencias' },
  { id: 'movimientos', label: 'Movimientos', path: '/negocio/movimientos', Page: MovimientosPage, ambito: 'negocio', permiso: 'listar_movimientos',
    permisosAlternativos: ['listar_movimientos', 'registrar_entrada', 'registrar_salida', 'ajustar_inventario'] },
  { id: 'auth', label: 'Acceso', path: '/', Page: AuthPage, ambito: 'publico', permiso: '' },
  { id: 'negocios', label: 'Plataforma', path: '/plataforma', Page: NegociosPage, ambito: 'plataforma', permiso: 'listar_negocios',
    permisosAlternativos: ['listar_negocios', 'crear_negocio', 'listar_usuarios', 'crear_usuario'] },
  { id: 'roles', label: 'Roles', path: '/negocio/roles', Page: RolesPage, ambito: 'negocio', permiso: 'listar_roles',
    permisosAlternativos: ['listar_roles', 'crear_rol'] },
  { id: 'membresias', label: 'Membresías', path: '/negocio/membresias', Page: MembresiasPage, ambito: 'negocio', permiso: 'listar_membresias',
    permisosAlternativos: ['listar_membresias', 'crear_membresia', 'asignar_rol'] },
]
