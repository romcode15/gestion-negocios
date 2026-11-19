import logout from '../../assets/icons/cerrar-sesion.svg'
import showPassword from '../../assets/icons/ver-contraseña.svg'
const icons = { logout, showPassword, hidePassword: showPassword }
export function AssetIcon({ name }: { name: keyof typeof icons }) {
  const icon = <span className="asset-icon" aria-hidden="true" style={{ maskImage: `url("${icons[name]}")`, WebkitMaskImage: `url("${icons[name]}")` }} />
  if (name === 'logout') return icon
  return <span className="password-eye-icon" aria-hidden="true">{icon}{name === 'hidePassword' &&
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m4 20 16-16" /></svg>}
  </span>
}
