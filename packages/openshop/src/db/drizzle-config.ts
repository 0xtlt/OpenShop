import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Path to the framework schema file — use in drizzle.config.ts */
export const frameworkSchemaPath = resolve(__dirname, 'schema.ts')
