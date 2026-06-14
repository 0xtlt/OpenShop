import graphqlPlugin from '@graphql-eslint/eslint-plugin'
import tseslint from 'typescript-eslint'
import type { Linter } from 'eslint'

/**
 * Default ESLint flat config for OpenShop projects.
 * Includes TypeScript parsing + GraphQL deprecation detection.
 *
 * Usage in eslint.config.js:
 *   import { eslintConfig } from 'openshop/eslint'
 *   export default eslintConfig
 */
export const eslintConfig: Linter.Config[] = [
  {
    ignores: ['types/generated/**', 'node_modules/**', 'dist/**'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: {
          allowDefaultProject: ['.graphqlrc.ts'],
        },
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    processor: graphqlPlugin.processor,
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-deprecated': 'error',
    },
  },
  {
    files: ['**/*.graphql'],
    languageOptions: {
      parser: graphqlPlugin.parser,
    },
    plugins: {
      '@graphql-eslint': graphqlPlugin,
    },
    rules: {
      '@graphql-eslint/no-deprecated': 'warn',
    },
  },
] as Linter.Config[]
