export class FastTableCountCache {
  private values = new Map<string, number>();
  private pending = new Map<string, Promise<number | null>>();
  private generation = 0;

  get(key: string): number | null {
    return this.values.get(key) ?? null;
  }

  load(key: string, fetchCount: () => Promise<number | null>): Promise<number | null> {
    const value = this.get(key);
    if (value !== null) return Promise.resolve(value);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const generation = this.generation;
    const promise = fetchCount()
      .then((count) => {
        if (count !== null && Number.isFinite(count) && generation === this.generation) {
          this.values.delete(key);
          this.values.set(key, count);
          if (this.values.size > 32) this.values.delete(this.values.keys().next().value!);
        }
        return count;
      })
      .catch(() => null)
      .finally(() => {
        if (this.pending.get(key) === promise) this.pending.delete(key);
      });
    this.pending.set(key, promise);
    return promise;
  }

  clear(): void {
    this.generation++;
    this.values.clear();
    this.pending.clear();
  }
}

export function canAdvanceFastPage(
  page: number,
  pageSize: number,
  recordCount: number,
  totalCount: number | null,
): boolean {
  return totalCount === null
    ? recordCount === pageSize
    : (page + 1) * pageSize < totalCount;
}
