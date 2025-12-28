/**
 * AsyncQueue - A simple async iterable queue for streaming events.
 *
 * Enables producer/consumer pattern where multiple producers can push
 * items and a single consumer can yield them as they arrive.
 * Used to enable true streaming of translation/TTS events.
 */

/**
 * An async queue that can be used as an async iterable.
 * Producers push items, consumer yields them as they arrive.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private resolvers: Array<(value: IteratorResult<T>) => void> = [];
  private closed = false;
  private error: Error | null = null;

  /**
   * Push an item to the queue.
   * If a consumer is waiting, it receives the item immediately.
   */
  push(item: T): void {
    if (this.closed) {
      return; // Silently ignore pushes after close
    }

    if (this.resolvers.length > 0) {
      // Consumer is waiting - resolve immediately
      const resolve = this.resolvers.shift()!;
      resolve({ value: item, done: false });
    } else {
      // No consumer waiting - buffer the item
      this.queue.push(item);
    }
  }

  /**
   * Push multiple items to the queue.
   */
  pushAll(items: T[]): void {
    for (const item of items) {
      this.push(item);
    }
  }

  /**
   * Close the queue, signaling no more items will be pushed.
   * Any waiting consumers will receive done: true.
   */
  close(): void {
    this.closed = true;

    // Resolve any waiting consumers with done
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve({ value: undefined as unknown as T, done: true });
    }
  }

  /**
   * Close the queue with an error.
   * Any waiting consumers will have the error thrown.
   */
  closeWithError(error: Error): void {
    this.error = error;
    this.closed = true;

    // Reject any waiting consumers
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      // We need to throw the error, but resolvers expect IteratorResult
      // Store error and let next() throw it
      resolve({ value: undefined as unknown as T, done: true });
    }
  }

  /**
   * Returns true if the queue is closed.
   */
  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Async iterator implementation.
   */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      const result = await this.next();
      if (result.done) {
        if (this.error) {
          throw this.error;
        }
        return;
      }
      yield result.value;
    }
  }

  /**
   * Get the next item from the queue.
   * Waits if the queue is empty but not closed.
   */
  private next(): Promise<IteratorResult<T>> {
    // Check for error first
    if (this.error) {
      return Promise.reject(this.error);
    }

    // Return buffered item if available
    if (this.queue.length > 0) {
      const item = this.queue.shift()!;
      return Promise.resolve({ value: item, done: false });
    }

    // Queue is empty and closed - done
    if (this.closed) {
      return Promise.resolve({ value: undefined as unknown as T, done: true });
    }

    // Queue is empty but not closed - wait for push or close
    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }
}
