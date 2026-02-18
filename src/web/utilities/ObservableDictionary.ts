export default class ObservableDictionary<T> extends EventTarget {
  private internal = new Map<string, T>();

  Add(id: string, obj: T) {
    this.internal.set(id, obj);
    this.dispatchEvent(new CustomEvent("change", { detail: { id } }));
  }

  Remove(id: string) {
    this.internal.delete(id);
    this.dispatchEvent(new CustomEvent("change", { detail: { id } }));
  }

  Get(id: string): T | undefined {
    return this.internal.get(id);
  }
}
