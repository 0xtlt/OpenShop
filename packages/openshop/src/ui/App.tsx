import { LocationProvider, Router, Route, useLocation } from 'preact-iso'
import type { ComponentChildren, ComponentType } from 'preact'
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
import { AdminPageGate, AdminPagesContext, useAdminPages } from './admin-pages'
import { sameAdminPages } from '../config/pages.ts'
import type { ResolvedAdminPages } from '../types.ts'
import type { CustomAdminPagesResponse } from '../config/custom-pages.ts'
import {
  customAdminPages,
  CustomAdminErrorBoundary,
  CustomAdminPageGate,
  CustomAdminPagesContext,
  LazyCustomAdminPage,
  useCustomAdminPages,
} from './custom-admin-pages'

const pagesRefreshMs = 10_000

function NavMenu() {
  const { url } = useLocation()
  const pages = useAdminPages()
  const customPages = useCustomAdminPages()

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
      {customPages.navigation.map((item) => (
        <a href={item.path} aria-current={url === item.path ? 'page' : undefined} key={item.path}>
          {item.label}
        </a>
      ))}
    </ui-nav-menu>
  )
}

function AuthGate({ children }: { children: ComponentChildren }) {
  const { url } = useLocation()
  const [status, setStatus] = useState<'checking' | 'ready' | 'blocked'>('checking')
  const [pages, setPages] = useState<ResolvedAdminPages | null>(null)
  const [customPages, setCustomPages] = useState<CustomAdminPagesResponse | null>(null)

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

        const [data, customData] = await Promise.all([
          apiJson<ResolvedAdminPages>('/api/pages'),
          apiJson<CustomAdminPagesResponse>('/api/pages/custom'),
        ])
        if (active) {
          setPages(data)
          setCustomPages(customData)
          setStatus('ready')
        }
      } catch {
        if (active) setStatus('blocked')
      }
    }

    void check()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (status !== 'ready') return
    let active = true

    const refresh = () => {
      void Promise.all([
        apiJson<ResolvedAdminPages>('/api/pages'),
        apiJson<CustomAdminPagesResponse>('/api/pages/custom'),
      ])
        .then(([data, customData]) => {
          if (!active) return
          setPages((current) => current && sameAdminPages(current, data) ? current : data)
          setCustomPages((current) => (
            current && JSON.stringify(current) === JSON.stringify(customData) ? current : customData
          ))
        })
        .catch(() => {})
    }

    refresh()
    const iv = setInterval(refresh, pagesRefreshMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', refresh)

    return () => {
      active = false
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', refresh)
    }
  }, [status, url])

  if (status === 'ready' && pages && customPages) {
    return (
      <AdminPagesContext.Provider value={pages}>
        <CustomAdminPagesContext.Provider value={customPages}>
          {children}
        </CustomAdminPagesContext.Provider>
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

  useEffect(
    () => addShopifyNavigateListener(
      route,
      document,
      () => window.location.origin,
      customAdminPages.map((page) => page.routePattern),
    ),
    [route],
  )

  return null
}

export default function App() {
  return (
    <LocationProvider>
      <ShopifyNavigateBridge />
      <AuthGate>
        <NavMenu />
        <AdminPageGate>
          <CustomAdminPageGate>
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
              {customAdminPages.map((page) => (
                <Route
                  key={page.id}
                  path={page.routePattern}
                  component={((props: Record<string, string>) => (
                    <CustomAdminErrorBoundary>
                      <LazyCustomAdminPage page={page} routeProps={props} />
                    </CustomAdminErrorBoundary>
                  )) as ComponentType}
                />
              ))}
            </Router>
          </CustomAdminPageGate>
        </AdminPageGate>
      </AuthGate>
    </LocationProvider>
  )
}
