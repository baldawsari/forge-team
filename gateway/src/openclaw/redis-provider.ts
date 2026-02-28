import Redis from 'ioredis';

export class RedisMessageBusProvider {
  private publisher: Redis;
  private subscriber: Redis;
  private handlers: Map<string, Set<(message: any) => void>>;

  constructor(redisUrl: string) {
    this.publisher = new Redis(redisUrl);
    this.subscriber = new Redis(redisUrl);
    this.handlers = new Map();

    this.subscriber.on('message', (channel, message) => {
      const parsed = JSON.parse(message);
      const channelHandlers = this.handlers.get(channel);
      if (channelHandlers) {
        for (const handler of channelHandlers) {
          handler(parsed);
        }
      }
    });
  }

  async publish(channel: string, message: any): Promise<void> {
    await this.publisher.publish(channel, JSON.stringify(message));
  }

  subscribe(channel: string, handler: (message: any) => void): () => void {
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
      this.subscriber.subscribe(channel);
    }
    this.handlers.get(channel)!.add(handler);

    return () => {
      const set = this.handlers.get(channel);
      if (set) {
        set.delete(handler);
        if (set.size === 0) {
          this.handlers.delete(channel);
          this.subscriber.unsubscribe(channel);
        }
      }
    };
  }

  async disconnect(): Promise<void> {
    await this.publisher.quit();
    await this.subscriber.quit();
  }
}
