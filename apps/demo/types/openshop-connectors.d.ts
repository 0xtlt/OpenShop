import type { ConnectorOf } from 'openshop'
import type { warehouse } from '../providers/warehouse'

declare global {
  interface OpenShopConnectors {
    warehouse: ConnectorOf<typeof warehouse>
  }
}
