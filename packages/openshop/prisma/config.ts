import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: './schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://openshop:openshop@localhost:5432/openshop',
  },
})
