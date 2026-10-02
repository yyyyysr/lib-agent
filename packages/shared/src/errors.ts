export type AppErrorCode =
  | 'invalid_params'
  | 'not_found'
  | 'not_configured'
  | 'no_model'
  | 'invalid_key'
  | 'insufficient_quota'
  | 'rate_limited'
  | 'model_not_found'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'import_failed'
  | 'unsupported_format'
  | 'core_unavailable'
  | 'internal';

export interface AppErrorShape {
  code: AppErrorCode;
  message: string;
  hint?: string;
}

export class AppError extends Error implements AppErrorShape {
  readonly code: AppErrorCode;
  readonly hint?: string;

  constructor(code: AppErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.hint = hint;
  }

  toJSON(): AppErrorShape {
    return { code: this.code, message: this.message, hint: this.hint };
  }
}

export function isAppErrorShape(value: unknown): value is AppErrorShape {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AppErrorShape).code === 'string' &&
    typeof (value as AppErrorShape).message === 'string'
  );
}
