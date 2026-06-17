# Testing And Verification

Use this reference to choose checks after OpenShop changes.

## Baseline

Run the workspace type check after TypeScript changes:

```bash
pnpm run check
```

This runs core TypeScript checks, UI TypeScript checks, and demo linting.

## Package Tests

From the repo root:

```bash
pnpm --filter openshop test
pnpm --filter openshop test:integration
```

Use targeted specs when the change is narrow:

- Engine behavior: `packages/openshop/tests/unit/engine/*.spec.ts` and `packages/openshop/tests/integration/engine/*.spec.ts`.
- Server/API/auth/proxy/webhooks: `packages/openshop/tests/integration/*.spec.ts` plus relevant `tests/unit/server/*.spec.ts`.
- CLI behavior: `packages/openshop/tests/unit/cli/*.spec.ts` or `packages/openshop/tests/integration/cli/*.spec.ts`.
- GraphQL codegen utilities: `packages/openshop/tests/unit/vite/codegen-utils.spec.ts`.
- UI utilities: `packages/openshop/tests/unit/ui/*.spec.ts`.

## Demo App

For changes affecting app usage, flows, providers, app proxy, or demo conventions, check `apps/demo/tests` and run the relevant demo test command if present.

## Test Style

- Prefer assertions against behavior and public contracts over implementation details.
- Add regression tests for bugs in retries, step persistence, scheduling, auth, signatures, GraphQL codegen, or generated templates.
- Keep integration tests for behavior that depends on DB state, HTTP requests, Shopify signatures/JWTs, worker execution, or generated app structure.
