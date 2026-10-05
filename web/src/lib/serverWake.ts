// Is the API slow to answer right now? The API runs on a free host that sleeps after
// ~15 minutes without requests and takes up to a minute to wake, which otherwise looks
// like the app hanging. lib/api.ts reports each request's wait for a response here;
// <ServerWakeNotice> shows a note while any of them has waited longer than SLOW_AFTER_MS.
//
// A plain module store (read with useSyncExternalStore), since api.ts isn't React.

const SLOW_AFTER_MS = 5_000;

let slowWaits = 0; // requests that have waited past SLOW_AFTER_MS and are still waiting
const listeners = new Set<() => void>();

function setSlowWaits(next: number) {
  slowWaits = next;
  listeners.forEach((listener) => listener());
}

// Call when a request is sent; call the returned function once its response has arrived
// (or it failed or was cancelled). Safe to call the returned function more than once.
export function trackWait(): () => void {
  let slow = false;
  let finished = false;
  const timer = setTimeout(() => {
    slow = true;
    setSlowWaits(slowWaits + 1);
  }, SLOW_AFTER_MS);

  return () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (slow) setSlowWaits(slowWaits - 1);
  };
}

export function subscribeSlowServer(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const isServerSlow = () => slowWaits > 0;
