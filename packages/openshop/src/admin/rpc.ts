export function buildAdminFunctionRpcUrl(
  kind: 'loader' | 'action',
  name: string,
  pathname: string,
): string {
  const normalizedPathname = pathname.replace(/\/$/, '') || '/'
  return `/api/pages/custom${normalizedPathname}/_rpc/${kind}/${encodeURIComponent(name)}`
}
