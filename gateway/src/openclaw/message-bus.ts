import { EventEmitter } from 'eventemitter3';
import type { OpenClawMessage } from './types';
import { RedisMessageBusProvider } from './redis-provider';

export interface IMessageBus {
  publish(channel: string, message: OpenClawMessage): Promise<void>;
  subscribe(channel: string, handler: (message: OpenClawMessage) => void): () => void;
  unsubscribe(channel: string): void;
}

export class MessageBus implements IMessageBus {
  private emitter = new EventEmitter();
  private redisProvider: RedisMessageBusProvider | null;

  constructor(options?: { redisUrl?: string }) {
    this.redisProvider = options?.redisUrl
      ? new RedisMessageBusProvider(options.redisUrl)
      : null;
  }

  async publish(channel: string, message: OpenClawMessage): Promise<void> {
    // Always emit locally (for in-process subscribers like dashboard WS connections)
    this.emitter.emit(channel, message);

    // Also publish to Redis if available (for cross-process subscribers)
    if (this.redisProvider) {
      await this.redisProvider.publish(channel, message);
    }
  }

  subscribe(channel: string, handler: (message: OpenClawMessage) => void): () => void {
    // Subscribe locally
    this.emitter.on(channel, handler);
    let redisUnsub: (() => void) | null = null;

    // Also subscribe via Redis if available
    if (this.redisProvider) {
      redisUnsub = this.redisProvider.subscribe(channel, handler);
    }

    return () => {
      this.emitter.off(channel, handler);
      if (redisUnsub) redisUnsub();
    };
  }

  unsubscribe(channel: string): void {
    this.emitter.removeAllListeners(channel);
  }

  async disconnect(): Promise<void> {
    if (this.redisProvider) {
      await this.redisProvider.disconnect();
    }
  }
}
