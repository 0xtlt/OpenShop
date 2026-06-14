import { createRequire } from 'node:module'

const DEFAULT_API_VERSION = '2026-04'
const DEFAULT_DOCUMENTS = ['./flows/**/*.{ts,tsx}', './webhooks/**/*.{ts,tsx}', './queries/**/*.{ts,tsx}']
const DEFAULT_OUTPUT_DIR = './types/generated'

type GqlTemplateNode = {
  type?: string
  quasis?: Array<{ value?: { raw?: string } }>
  leadingComments?: Array<{ value?: string; start?: number }>
}

interface PluckOptions {
  gqlMagicComment?: string
}

interface PluckLocation {
  start: number
  end: number
  leadingComments?: Array<{ start?: number }>
}

/** Pluck config for detecting `#graphql` inside template literals. */
const pluckConfig = {
  isGqlTemplateLiteral: (node: GqlTemplateNode, options: PluckOptions) => {
    const hasInternalGqlComment = node.type === 'TemplateLiteral' && /\s*#graphql\s*\n/i.test(node.quasis?.[0]?.value?.raw || '')
    if (hasInternalGqlComment) return true
    const leadingComment = node.leadingComments?.[node.leadingComments.length - 1]
    return leadingComment?.value?.trim().toLowerCase() === options?.gqlMagicComment
  },
  pluckStringFromFile: (code: string, { start, end, leadingComments }: PluckLocation) => {
    let gqlTemplate = code.slice(start + 1, end - 1).replace(/\$\{([^}]*)\}/g, (_: string, m1: string) => '#REQUIRED_VAR=' + m1).split('\\`').join('`')
    const chunkStart = leadingComments?.[0]?.start ?? start
    const codeBeforeNode = code.slice(0, chunkStart)
    const [, varName] = codeBeforeNode.match(/\s(\w+)\s*=\s*$/) || []
    if (varName) gqlTemplate += '#VAR_NAME=' + varName
    return gqlTemplate
  },
}

interface GraphqlConfigOptions {
  /** Shopify Admin API version (default: 2026-04) */
  apiVersion?: string
  /** Glob patterns for files containing GraphQL operations */
  documents?: string[]
  /** Output directory for generated types */
  outputDir?: string
}

/**
 * Default graphql-config for OpenShop projects.
 *
 * Usage in .graphqlrc.ts:
 *   import { graphqlConfig } from 'openshop/graphql'
 *   export default graphqlConfig()
 */
export function graphqlConfig(options?: GraphqlConfigOptions) {
  const apiVersion = options?.apiVersion ?? DEFAULT_API_VERSION
  const documents = options?.documents ?? DEFAULT_DOCUMENTS
  const outputDir = options?.outputDir ?? DEFAULT_OUTPUT_DIR

  // Resolve @shopify/api-codegen-preset from the consumer's node_modules (not from openshop source)
  const require = createRequire(process.cwd() + '/package.json')
  const { shopifyApiProject, ApiType } = require('@shopify/api-codegen-preset')

  const shopifyProject = shopifyApiProject({
    apiType: ApiType.Admin,
    apiVersion,
    documents,
    outputDir,
    enumsAsConst: true,
  })

  return {
    schema: `https://shopify.dev/admin-graphql-direct-proxy/${apiVersion}`,
    documents,
    projects: {
      default: {
        ...shopifyProject,
        extensions: {
          ...shopifyProject.extensions,
          pluckConfig,
        },
      },
    },
  }
}
