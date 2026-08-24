import { createContext } from 'preact'
import { useContext } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import type { ComponentChildren } from 'preact'
import type { ResolvedAdminPages } from '../types.ts'
import { adminPageFromUiPath } from '../config/pages.ts'
import Disabled from './pages/Disabled'

export const AdminPagesContext = createContext<ResolvedAdminPages | null>(null)

export function useAdminPages(): ResolvedAdminPages {
  const pages = useContext(AdminPagesContext)
  if (!pages) throw new Error('Admin pages config is not loaded')
  return pages
}

export function AdminPageGate({ children }: { children: ComponentChildren }) {
  const { path } = useLocation()
  const pages = useAdminPages()
  const page = adminPageFromUiPath(path)
  if (page && pages[page] === 'disabled') return <Disabled />
  return <>{children}</>
}
