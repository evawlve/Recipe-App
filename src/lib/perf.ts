export async function time<T>(name: string, fn: () => Promise<T>) {
  const start = performance.now();
  try {
    const result = await fn();
    const ms = Math.round(performance.now() - start);
    console.log(JSON.stringify({ type: "perf", name, ms }));
    return result;
  } catch (e) {
    const ms = Math.round(performance.now() - start);
    console.log(
      JSON.stringify({ type: "perf", name, ms, error: String(e) })
    );
    throw e;
  }
}


