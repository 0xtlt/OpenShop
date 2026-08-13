import { createContext } from 'preact'
import { useContext } from 'preact/hooks'
import type { ComponentType } from 'preact'
import type { AdminPageId, ResolvedAdminPages } from '../types.ts'
import Disabled from './pages/Disabled'

export const AdminPagesContext = createContext<ResolvedAdminPages | null>(null)

export function useAdminPages(): ResolvedAdminPages {
  const pages = useContext(AdminPagesContext)
  if (!pages) throw new Error('Admin pages config is not loaded')
  return pages
}

export function gateAdminPage<P extends object>(page: AdminPageId, Component: ComponentType<P>) {
  return function GatedAdminPage(props: P) {
    const pages = useAdminPages()
    if (pages[page] === 'disabled') return <Disabled />
    return <Component {...props} />
  }
}
