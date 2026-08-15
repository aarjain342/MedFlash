// Runs `worker(item, index)` over `items` with at most `limit` in flight at once.
// Calls `onSettled(index, result, error)` as soon as each item finishes (order not guaranteed).
export async function runWithConcurrency(items, limit, worker, onSettled) {
  let next = 0;

  async function run() {
    while (next < items.length) {
      const index = next++;
      try {
        const result = await worker(items[index], index);
        onSettled(index, result, null);
      } catch (err) {
        onSettled(index, null, err);
      }
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, run);
  await Promise.all(runners);
}
