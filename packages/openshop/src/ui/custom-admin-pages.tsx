import { Component, createContext } from 'preact'
import type { ComponentChildren } from 'preact'
import { useContext, useEffect, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { customAdminPages, type CustomAdminClientPage } from 'virtual:openshop-admin-pages'
import type { AdminPageDefinition } from '../admin/index.ts'
import { matchCustomAdminPath, type CustomAdminPagesResponse } from '../config/custom-pages.ts'
import Disabled from './pages/Disabled'

export { customAdminPages }

export const CustomAdminPagesContext = createContext<CustomAdminPagesResponse>({
  navigation: [],
  pages: [],
})

export function useCustomAdminPages(): CustomAdminPagesResponse {
  return useContext(CustomAdminPagesContext)
}

interface ErrorBoundaryState {
  error?: Error
}

export class CustomAdminErrorBoundary extends Component<
  { children: ComponentChildren },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {}

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <s-page heading="Page unavailable">
        <s-banner tone="critical">
          This custom page could not be displayed.
        </s-banner>
      </s-page>
    )
  }
}

export function LazyCustomAdminPage({
  page,
  routeProps,
}: {
  page: CustomAdminClientPage
  routeProps: Record<string, string>
}) {
  const [definition, setDefinition] = useState<AdminPageDefinition<Record<string, string>> | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let active = true
    void page.load()
      .then((module) => {
        if (active) setDefinition(module.default)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason : new Error(String(reason)))
      })
    return () => { active = false }
  }, [page])

  if (error) throw error
  if (!definition) return <s-page><s-spinner accessibilityLabel="Loading page" /></s-page>
  const Page = definition.component
  return <Page {...routeProps} />
}

export function CustomAdminPageGate({ children }: { children: ComponentChildren }) {
  const { path } = useLocation()
  const access = useCustomAdminPages()
  const page = customAdminPages.find((candidate) => matchCustomAdminPath(candidate.routePattern, path))
  if (!page) return <>{children}</>
  const allowed = access.pages.find((candidate) => candidate.id === page.id)?.allowed
  return allowed ? <>{children}</> : <Disabled />
}
