import type { ConnectorOf } from 'openshop'
import type { warehouse } from '../providers/warehouse'
import type { ftp } from '../providers/ftp'

declare global {
  interface OpenShopConnectors {
    warehouse: ConnectorOf<typeof warehouse>
    ftp: ConnectorOf<typeof ftp>
  }
}
