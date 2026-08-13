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
import { apiJson } from './fetch'
import { AdminPagesContext, gateAdminPage, useAdminPages } from './admin-pages'
import type { ResolvedAdminPages } from '../types.ts'

function NavMenu() {
  const { url } = useLocation()
  const pages = useAdminPages()

  return (
    <ui-nav-menu>
      <a href="/" rel="home" aria-current={url === '/' ? 'page' : undefined}>
        Home
      </a>
      {pages.flows === 'visible' && (
        <a href="/flows" aria-current={url.startsWith('/flows') ? 'page' : undefined}>
          Flows
        </a>
      )}
      {pages.providers === 'visible' && (
        <a href="/providers" aria-current={url === '/providers' ? 'page' : undefined}>
          Providers
        </a>
      )}
      {pages.mcp === 'visible' && (
        <a href="/mcp" aria-current={url === '/mcp' ? 'page' : undefined}>
          MCP
        </a>
      )}
      {pages.crons === 'visible' && (
        <a href="/crons" aria-current={url === '/crons' ? 'page' : undefined}>
          Crons
        </a>
      )}
      {pages.functions === 'visible' && (
        <a href="/functions" aria-current={url.startsWith('/functions') ? 'page' : undefined}>
          Functions
        </a>
      )}
    </ui-nav-menu>
  )
}

function AuthGate({ children }: { children: ComponentChildren }) {
  const [status, setStatus] = useState<'checking' | 'ready' | 'blocked'>('checking')
  const [pages, setPages] = useState<ResolvedAdminPages | null>(null)

  useEffect(() => {
    let active = true

    const check = async (attempt = 0) => {
      try {
        if (!window.shopify?.idToken && attempt < 20) {
          setTimeout(() => { void check(attempt + 1) }, 100)
          return
        }

        const token = await window.shopify?.idToken?.()
        if (!token) {
          if (active) setStatus('blocked')
          return
        }

        const data = await apiJson<ResolvedAdminPages>('/api/pages')
        if (active) {
          setPages(data)
          setStatus('ready')
        }
      } catch {
        if (active) setStatus('blocked')
      }
    }

    void check()
    return () => { active = false }
  }, [])

  if (status === 'ready' && pages) {
    return (
      <AdminPagesContext.Provider value={pages}>
        {children}
      </AdminPagesContext.Provider>
    )
  }

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

const FlowsPage = gateAdminPage('flows', Flows)
const FlowRunPage = gateAdminPage('flows', FlowRun)
const CronsPage = gateAdminPage('crons', Crons)
const ProvidersPage = gateAdminPage('providers', Providers)
const McpPage = gateAdminPage('mcp', Mcp)
const FunctionsPage = gateAdminPage('functions', Functions)

export default function App() {
  return (
    <LocationProvider>
      <ShopifyNavigateBridge />
      <AuthGate>
        <NavMenu />
        <Router>
          <Route path="/" component={Home} />
          <Route path="/flows" component={FlowsPage} />
          <Route path="/flows/:name" component={FlowsPage} />
          <Route path="/runs/:id" component={FlowRunPage} />
          <Route path="/crons" component={CronsPage} />
          <Route path="/providers" component={ProvidersPage} />
          <Route path="/mcp" component={McpPage} />
          <Route path="/functions" component={FunctionsPage} />
          <Route path="/functions/:handle" component={FunctionsPage} />
          <Route path="/functions/:handle/:action" component={FunctionsPage} />
        </Router>
      </AuthGate>
    </LocationProvider>
  )
}
