import { AsyncLocalStorage } from 'node:async_hooks';

export interface ContextStore {
  requestId?: string;
  traceId?: string;
}

const storage = new AsyncLocalStorage<ContextStore>();

export function runInContext<T>(fn: () => T, overrides: ContextStore = {}): T {
  const parent = storage.getStore();
  const store: ContextStore = { ...parent };
  if (overrides.traceId) store.traceId = overrides.traceId;
  return storage.run(store, fn);
}

export function currentContext(): ContextStore | undefined {
  return storage.getStore();
}

export function setContextRequestId(requestId: string | undefined): void {
  if (!requestId) return;
  const store = storage.getStore();
  if (store) store.requestId = requestId;
}
