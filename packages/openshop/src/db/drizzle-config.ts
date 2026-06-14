import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const filename = fileURLToPath(import.meta.url)
const __dirname = dirname(filename)
const schemaExtension = filename.endsWith('.ts') ? 'ts' : 'js'

/** Path to the framework schema file — use in drizzle.config.ts */
export const frameworkSchemaPath = resolve(__dirname, `schema.${schemaExtension}`)
