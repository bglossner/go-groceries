let queue: Promise<unknown> = Promise.resolve();
/** Serialize metadata replacement with publication, including across tabs with Web Locks. */
export function withCloudSyncLock<T>(action: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request('go-groceries-cloud-publish', action);
  const work = queue.then(action, action);
  queue = work.catch(() => undefined);
  return work;
}
