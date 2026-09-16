declare module 'virtual:openshop-admin-pages' {
  import type { AdminPageDefinition } from '../admin/index.ts'

  export interface CustomAdminClientPage {
    id: string
    path: string
    routePattern: string
    load(): Promise<{ default: AdminPageDefinition<Record<string, string>> }>
  }

  export const customAdminPages: CustomAdminClientPage[]
}
