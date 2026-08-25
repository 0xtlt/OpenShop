export type FunctionManagementErrorCode =
  | 'invalid_request'
  | 'function_not_found'
  | 'instance_not_found'
  | 'operation_not_supported'
  | 'instance_limit_reached'
  | 'shopify_user_error'
  | 'shopify_error'

export class FunctionManagementError extends Error {
  readonly code: FunctionManagementErrorCode
  readonly status: 400 | 404 | 405 | 409 | 502
  readonly details?: unknown

  constructor(
    code: FunctionManagementErrorCode,
    status: 400 | 404 | 405 | 409 | 502,
    message: string,
    details?: unknown,
  ) {
    super(message)
    this.name = 'FunctionManagementError'
    this.code = code
    this.status = status
    this.details = details
  }
}
