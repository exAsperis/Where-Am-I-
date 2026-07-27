export class SceneReadinessTrigger {
  #lastReady: boolean | undefined;

  observe(ready: boolean): boolean {
    const shouldFocus = ready && this.#lastReady !== true;
    this.#lastReady = ready;
    return shouldFocus;
  }
}
