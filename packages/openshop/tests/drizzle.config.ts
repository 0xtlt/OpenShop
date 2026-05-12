import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/db/schema.ts'],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://openshop:openshop@localhost:5432/openshop_test',
  },
})
