import { AppRoutes } from './app/routes/AppRoutes'
import { SessionProvider } from './app/providers/SessionProvider'
export default function App() { return <SessionProvider><AppRoutes /></SessionProvider> }
