import { LocationProvider, Router, Route, useLocation } from 'preact-iso'
import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import Home from './pages/Home'
import Flows from './pages/Flows'
import FlowRun from './pages/FlowRun'
import Providers from './pages/Providers'
import Functions from './pages/Functions'
import Crons from './pages/Crons'
import Mcp from './pages/Mcp'
import { addShopifyNavigateListener } from './navigation'

function NavMenu() {
  const { url } = useLocation()

  return (
    <ui-nav-menu>
      <a href="/" rel="home" aria-current={url === '/' ? 'page' : undefined}>
        Home
      </a>
      <a href="/flows" aria-current={url.startsWith('/flows') ? 'page' : undefined}>
        Flows
      </a>
      <a href="/providers" aria-current={url === '/providers' ? 'page' : undefined}>
        Providers
      </a>
      <a href="/mcp" aria-current={url === '/mcp' ? 'page' : undefined}>
        MCP
      </a>
      <a href="/crons" aria-current={url === '/crons' ? 'page' : undefined}>
        Crons
      </a>
      <a href="/functions" aria-current={url.startsWith('/functions') ? 'page' : undefined}>
        Functions
      </a>
    </ui-nav-menu>
  )
}

function AuthGate({ children }: { children: ComponentChildren }) {
  const [status, setStatus] = useState<'checking' | 'ready' | 'blocked'>('checking')

  useEffect(() => {
    let active = true

    const check = async (attempt = 0) => {
      try {
        if (!window.shopify?.idToken && attempt < 20) {
          setTimeout(() => { void check(attempt + 1) }, 100)
          return
        }

        const token = await window.shopify?.idToken?.()
        if (active) setStatus(token ? 'ready' : 'blocked')
      } catch {
        if (active) setStatus('blocked')
      }
    }

    void check()
    return () => { active = false }
  }, [])

  if (status === 'ready') return <>{children}</>

  return (
    <main style={{ maxWidth: '560px', margin: '80px auto', padding: '0 24px', fontFamily: 'system-ui, sans-serif' }}>
      {status === 'checking'
        ? <p>Loading...</p>
        : (
          <>
            <h1>Open this app from Shopify admin</h1>
            <p>This interface is only available inside an authenticated Shopify admin session.</p>
          </>
        )}
    </main>
  )
}

function ShopifyNavigateBridge() {
  const { route } = useLocation()

  useEffect(() => addShopifyNavigateListener(route), [route])

  return null
}

export default function App() {
  return (
    <LocationProvider>
      <ShopifyNavigateBridge />
      <AuthGate>
        <NavMenu />
        <Router>
          <Route path="/" component={Home} />
          <Route path="/flows" component={Flows} />
          <Route path="/flows/:name" component={Flows} />
          <Route path="/runs/:id" component={FlowRun} />
          <Route path="/crons" component={Crons} />
          <Route path="/providers" component={Providers} />
          <Route path="/mcp" component={Mcp} />
          <Route path="/functions" component={Functions} />
          <Route path="/functions/:handle" component={Functions} />
          <Route path="/functions/:handle/:action" component={Functions} />
        </Router>
      </AuthGate>
    </LocationProvider>
  )
}
