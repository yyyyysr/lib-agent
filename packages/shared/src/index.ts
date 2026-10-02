export * from './book';
export * from './errors';
export * from './exhibition';
export * from './ipc';
export * from './provider';
export * from './rpc';
export * from './school';
export * from './user';

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
