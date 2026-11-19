import { AppRoutes } from './app/routes/AppRoutes'
import { SessionProvider } from './app/providers/SessionProvider'
import { ToastProvider } from './components/feedback/ToastProvider'
export default function App() { return <ToastProvider><SessionProvider><AppRoutes /></SessionProvider></ToastProvider> }
