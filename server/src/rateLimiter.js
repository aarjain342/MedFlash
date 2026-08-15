// Ensures at most one request is dispatched every `minIntervalMs`, across all callers,
// regardless of how many are running concurrently. Protects against bursty concurrency
// blowing through a provider's free-tier requests-per-minute cap.
export function createRateLimiter(minIntervalMs) {
  let chain = Promise.resolve();
  let last = 0;

  return function acquire() {
    const result = chain.then(async () => {
      const wait = Math.max(0, last + minIntervalMs - Date.now());
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
    });
    chain = result.catch(() => {});
    return result;
  };
}
