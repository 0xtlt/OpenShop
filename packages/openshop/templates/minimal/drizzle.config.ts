import { defineConfig } from 'drizzle-kit'
import { frameworkSchemaPath } from 'openshop/drizzle'

export default defineConfig({
  dialect: 'postgresql',
  schema: [frameworkSchemaPath, './models/**/*.ts'],
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://openshop:openshop@localhost:5432/openshop',
  },
  migrations: {
    schema: 'drizzle',
    table: '__drizzle_migrations',
  },
})
