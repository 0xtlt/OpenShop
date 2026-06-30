import { defineOpenShop } from 'openshop'
import { warehouse } from '#providers/warehouse'

export const app = defineOpenShop({
  providers: { warehouse },
})
