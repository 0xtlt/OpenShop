import { defineOpenShop } from 'openshop'
import { warehouse } from './providers/warehouse.ts'

export const app = defineOpenShop({
  providers: { warehouse },
})
