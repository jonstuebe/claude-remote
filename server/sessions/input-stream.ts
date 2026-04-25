import type { SpawnInputMessage } from "./types.ts";

export class InputStream implements AsyncIterable<SpawnInputMessage> {
  private queue: SpawnInputMessage[] = [];
  private resolvers: Array<(result: IteratorResult<SpawnInputMessage>) => void> = [];
  private closed = false;

  push(message: SpawnInputMessage): void {
    if (this.closed) return;
    const next = this.resolvers.shift();
    if (next) {
      next({ value: message, done: false });
      return;
    }
    this.queue.push(message);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const resolve of this.resolvers) {
      resolve({ value: undefined as unknown as SpawnInputMessage, done: true });
    }
    this.resolvers.length = 0;
  }

  [Symbol.asyncIterator](): AsyncIterator<SpawnInputMessage> {
    return {
      next: (): Promise<IteratorResult<SpawnInputMessage>> => {
        const buffered = this.queue.shift();
        if (buffered) return Promise.resolve({ value: buffered, done: false });
        if (this.closed) {
          return Promise.resolve({
            value: undefined as unknown as SpawnInputMessage,
            done: true,
          });
        }
        return new Promise((resolve) => this.resolvers.push(resolve));
      },
    };
  }
}
