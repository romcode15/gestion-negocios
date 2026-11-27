type IconName = 'home' | 'negocios' | 'roles' | 'membresias' | 'logout' | 'categorias' | 'productos' | 'existencias' | 'movimientos' | 'nueva-venta' | 'ventas'
const paths: Record<IconName, string> = {
  'nueva-venta': 'M3 3h2l3 12h10l3-8H6m3 12h.01M18 19h.01M12 3v6m-3-3h6',
  ventas: 'M6 3h12v18l-3-2-3 2-3-2-3 2Zm3 4h6m-6 4h6m-6 4h4',
  categorias: 'M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z',
  productos: 'm3 7 9-4 9 4v10l-9 4-9-4Zm0 0 9 4 9-4m-9 4v10M7 5l10 4',
  existencias: 'M3 3h18v5H3Zm2 5v13h14V8m-10 4h6',
  movimientos: 'M3 7h17m-5-5 5 5-5 5M21 17H4m5-5-5 5 5 5',
  home: 'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
  negocios: 'M4 21V7h16v14M8 7V3h8v4M2 21h20M8 11h2m4 0h2m-8 4h2m4 0h2',
  roles: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-4 9 3 3 5-6',
  membresias: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  logout: 'M9 21H4V3h5m7 14 5-5-5-5m-9 5h14',
}
export function ModuleIcon({ name }: { name: IconName }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
