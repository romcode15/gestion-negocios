import type { ApiRequest, Transport } from '../../api/contracts'
import { ApiException } from '../../api/errors'
import type { Sesion } from '../../features/auth/types'
import type { Usuario } from '../../features/usuarios/types'
import type { Pagina } from '../../api/types'
import { crearDatosIniciales, globalCodes } from '../data/seed'

type Scenario = 'normal' | 'empty' | 'validation_error' | 'invalid_credentials' | 'not_authenticated' | 'permission_denied' | 'csrf_failed' | 'not_found'
export const TAMANO_PAGINA = 2
let data = crearDatosIniciales()
let passwords = new Map(data.usuarios.map((u) => [u.username, 'Demo-12345!']))
// Solo identidad ficticia de cuentas semilla; nunca contraseñas ni tokens.
const SESSION_KEY = 'gestion-negocios:mock-user'
function readIdentity(): number | null {
  try {
    const id = Number(sessionStorage.getItem(SESSION_KEY))
    return data.usuarios.some((user) => user.id === id) ? id : null
  } catch { return null }
}
function rememberIdentity(id: number | null) {
  try {
    if (id === null) sessionStorage.removeItem(SESSION_KEY)
    else sessionStorage.setItem(SESSION_KEY, String(id))
  } catch { /* Almacenamiento bloqueado: la sesión queda solo en memoria. */ }
}
let userId: number | null = readIdentity()
let csrf = userId !== null
let latency = 150
let scenario: Scenario = 'normal'
export function reiniciarMocks() {
  data = crearDatosIniciales()
  passwords = new Map(data.usuarios.map((u) => [u.username, 'Demo-12345!']))
  userId = null; csrf = false; latency = 150; scenario = 'normal'
  rememberIdentity(null)
}
export function configurarMocks(options: { latencia?: number; escenario?: Scenario; usuariosInactivos?: number[] }) {
  if (options.latencia !== undefined) latency = Math.max(0, options.latencia)
  if (options.escenario !== undefined) scenario = options.escenario
  if (options.usuariosInactivos) {
    for (const user of data.usuarios) {
      if (options.usuariosInactivos.includes(user.id)) user.is_active = false
    }
  }
}
function fail(code: string, detail: string, status: number, errors: Record<string, string[]> = {}): never {
  throw new ApiException(code, detail, errors, status)
}
function validation(field: string, message: string): never { return fail('validation_error', 'Revisa los campos indicados.', 400, { [field]: [message] }) }
function account(): Usuario {
  const user = data.usuarios.find((u) => u.id === userId && u.is_active)
  return user ?? fail('not_authenticated', 'Inicia sesión para continuar.', 403)
}
function codes(roleId: number): string[] {
  const role = data.roles.find((r) => r.id === roleId)
  return data.permisos.filter((p) => role?.permiso_ids.includes(p.id)).map((p) => p.codigo)
}
function session(): Sesion {
  const usuario = account()
  return {
    usuario, permisos_globales: usuario.id === 1 ? [...globalCodes] : [],
    negocios: data.membresias.filter((m) => m.usuario.id === usuario.id && m.activo)
      .flatMap((m) => {
        const negocio = data.negocios.find((n) => n.id === m.negocio_id && n.activo)
        return negocio ? [{ id: negocio.id, nombre: negocio.nombre, rol_id: m.rol_id, permisos: codes(m.rol_id) }] : []
      }),
  }
}
function authorize(permission: string, negocioId?: number) {
  const current = session()
  const granted = negocioId === undefined ? current.permisos_globales : current.negocios.find((n) => n.id === negocioId)?.permisos
  if (!granted?.includes(permission)) fail('permission_denied', 'No tienes permiso para realizar esta acción.', 403)
}
function bodyRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return validation('non_field_errors', 'Envía un objeto.')
  return body as Record<string, unknown>
}
function text(body: Record<string, unknown>, field: string): string {
  const value = body[field]
  if (typeof value !== 'string' || !value.trim()) return validation(field, 'Este campo es requerido.')
  return value
}
function id(body: Record<string, unknown>, field: string): number {
  const value = body[field]
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return validation(field, 'Selecciona un ID válido.')
  return value
}
function nextId(items: { id: number }[]) { return Math.max(0, ...items.map((item) => item.id)) + 1 }
function createUser(body: Record<string, unknown>): Usuario {
  const username = text(body, 'username')
  const password = text(body, 'password')
  if (password.length < 8) validation('password', 'Usa al menos 8 caracteres en esta simulación.')
  if (data.usuarios.some((u) => u.username === username)) validation('username', 'El nombre de usuario ya existe.')
  return { id: nextId(data.usuarios), username, is_active: true }
}
function page<T>(items: T[], path: string, pageNumber: number): Pagina<T> {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || (pageNumber > 1 && (pageNumber - 1) * TAMANO_PAGINA >= items.length)) fail('not_found', 'La página no existe.', 404)
  const link = (n: number) => 'mock:/api/v1' + path + '?page=' + n
  return { count: items.length, next: pageNumber * TAMANO_PAGINA < items.length ? link(pageNumber + 1) : null,
    previous: pageNumber > 1 ? link(pageNumber - 1) : null,
    results: items.slice((pageNumber - 1) * TAMANO_PAGINA, pageNumber * TAMANO_PAGINA) }
}
async function wait(signal?: AbortSignal) {
  signal?.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason ?? new DOMException('Cancelado', 'AbortError')) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, latency)
    signal?.addEventListener('abort', abort, { once: true })
  })
  signal?.throwIfAborted()
}
function dispatch({ method, path, body }: ApiRequest): unknown {
  const url = new URL(path, 'http://mock.local')
  const route = url.pathname
  const pageNumber = Number(url.searchParams.get('page') ?? 1)
  const currentScenario = scenario
  scenario = 'normal'
  if (currentScenario !== 'normal' && currentScenario !== 'empty') {
    if (currentScenario === 'not_authenticated') { userId = null; rememberIdentity(null) }
    if (currentScenario === 'csrf_failed') csrf = false
    fail(currentScenario, 'Escenario simulado: ' + currentScenario,
      ['validation_error', 'invalid_credentials'].includes(currentScenario) ? 400 : currentScenario === 'not_found' ? 404 : 403,
      currentScenario === 'validation_error' ? { non_field_errors: ['Validación simulada.'] } : {})
  }
  if (route === '/auth/csrf/' && method === 'GET') { csrf = true; return undefined }
  if (method !== 'GET' && !csrf) fail('csrf_failed', 'Obtén un token CSRF antes de enviar.', 403)
  if (route === '/auth/login/' && method === 'POST') {
    const input = bodyRecord(body)
    const username = text(input, 'username')
    const password = text(input, 'password')
    const user = data.usuarios.find((u) => u.username === username && u.is_active)
    if (!user || passwords.get(username) !== password) fail('invalid_credentials', 'Credenciales inválidas.', 400)
    userId = user.id
    rememberIdentity(user.id)
    return session()
  }
  if (route === '/auth/me/' && method === 'GET') return session()
  if (route === '/auth/logout/' && method === 'POST') { account(); userId = null; rememberIdentity(null); return undefined }
  account()
  const list = <T,>(items: T[]) => page(currentScenario === 'empty' ? [] : items, route, pageNumber)
  if (route === '/plataforma/usuarios/') {
    authorize(method === 'GET' ? 'listar_usuarios' : 'crear_usuario')
    if (method === 'GET') return list(data.usuarios)
    if (method === 'POST') {
      const input = bodyRecord(body)
      const user = createUser(input)
      data.usuarios.push(user); passwords.set(user.username, text(input, 'password'))
      return user
    }
  }
  if (route === '/plataforma/negocios/') {
    authorize(method === 'GET' ? 'listar_negocios' : 'crear_negocio')
    if (method === 'GET') return list(data.negocios)
    if (method === 'POST') {
      const input = bodyRecord(body)
      const nombre = text(input, 'nombre'), tipo = text(input, 'tipo'), adminId = id(input, 'administrador_id')
      const admin = data.usuarios.find((u) => u.id === adminId && u.is_active)
      if (!admin) return validation('administrador_id', 'Selecciona una cuenta activa.')
      const negocio = { id: nextId(data.negocios), nombre, tipo, activo: true }
      const role = { id: nextId(data.roles), nombre: 'Administrador de negocio', negocio_id: negocio.id, predefinido: true,
        permiso_ids: data.permisos.filter((p) => p.ambito === 'negocio').map((p) => p.id) }
      // Se valida todo antes de modificar las tres colecciones.
      data.negocios.push(negocio); data.roles.push(role)
      data.membresias.push({ id: nextId(data.membresias), usuario: admin, negocio_id: negocio.id, rol_id: role.id, activo: true })
      return negocio
    }
  }
  const match = route.match(/^\/negocios\/(\d+)\/(permisos|roles|membresias)\/(?:(\d+)\/)?$/)
  if (match) {
    const negocioId = Number(match[1]), resource = match[2], membershipId = match[3] ? Number(match[3]) : undefined
    const permission = resource === 'permisos' ? 'crear_rol' : resource === 'roles' ? (method === 'GET' ? 'listar_roles' : 'crear_rol')
      : method === 'GET' ? 'listar_membresias' : method === 'PATCH' ? 'asignar_rol' : 'crear_membresia'
    authorize(permission, negocioId)
    if (!data.negocios.some((n) => n.id === negocioId && n.activo)) fail('not_found', 'Negocio no disponible.', 404)
    const allowed = session().negocios.find((n) => n.id === negocioId)?.permisos ?? []
    if (resource === 'permisos' && method === 'GET' && membershipId === undefined) return list(data.permisos.filter((p) => p.ambito === 'negocio' && allowed.includes(p.codigo)))
    if (resource === 'roles' && membershipId === undefined) {
      if (method === 'GET') return list(data.roles.filter((r) => r.negocio_id === negocioId))
      if (method === 'POST') {
        const input = bodyRecord(body), nombre = text(input, 'nombre'), ids = input.permiso_ids
        if (!Array.isArray(ids) || !ids.every((v) => typeof v === 'number' && Number.isInteger(v))) return validation('permiso_ids', 'Envía una lista de IDs numéricos.')
        if (new Set(ids).size !== ids.length || ids.some((v) => !data.permisos.some((p) => p.id === v && p.ambito === 'negocio' && allowed.includes(p.codigo)))) return validation('permiso_ids', 'Hay permisos no delegables o repetidos.')
        if (data.roles.some((r) => r.negocio_id === negocioId && r.nombre === nombre)) return validation('nombre', 'El rol ya existe en este negocio.')
        const role = { id: nextId(data.roles), nombre, negocio_id: negocioId, predefinido: false, permiso_ids: ids as number[] }
        data.roles.push(role); return role
      }
    }
    if (resource === 'membresias') {
      if (method === 'GET' && membershipId === undefined) return list(data.membresias.filter((m) => m.negocio_id === negocioId))
      const input = bodyRecord(body), roleId = id(input, 'rol_id')
      if (!data.roles.some((r) => r.id === roleId && r.negocio_id === negocioId)) return validation('rol_id', 'Selecciona un rol del negocio activo.')
      if (method === 'PATCH' && membershipId !== undefined) {
        const membership = data.membresias.find((m) => m.id === membershipId && m.negocio_id === negocioId)
        if (!membership) return fail('not_found', 'Membresía no disponible.', 404)
        membership.rol_id = roleId; return membership
      }
      if (method === 'POST' && membershipId === undefined) {
        const username = text(input, 'username')
        const isNew = Object.hasOwn(input, 'password')
        const user = isNew ? createUser(input) : data.usuarios.find((u) => u.username === username && u.is_active)
        if (!user) return validation('username', 'No existe una cuenta activa con ese nombre.')
        if (data.membresias.some((m) => m.usuario.id === user.id && m.negocio_id === negocioId)) return validation('username', 'La cuenta ya pertenece al negocio.')
        const membership = { id: nextId(data.membresias), usuario: user, negocio_id: negocioId, rol_id: roleId, activo: true }
        if (isNew) { data.usuarios.push(user); passwords.set(username, text(input, 'password')) }
        data.membresias.push(membership); return membership
      }
    }
  }
  return fail('not_found', 'Recurso no disponible.', 404)
}
export const mockTransport: Transport = {
  async request<T>(request: ApiRequest): Promise<T> {
    await wait(request.signal)
    try { return structuredClone(dispatch(request)) as T } catch (error) {
      if (error instanceof ApiException && error.code === 'csrf_failed') csrf = true
      throw error
    }
  },
}
