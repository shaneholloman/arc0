import { EventEmitter } from "node:events";
import type { SessionEvent } from "@arc0/types";
import type { SessionFile } from "./types.js";

// Re-export StoredLine from its canonical location
export type { StoredLine } from "../daemon/jsonl/store.js";
import type { StoredLine } from "../daemon/jsonl/store.js";

/**
 * All event types in one place.
 * Format: "event:name": [arg1, arg2, ...]
 */
export type EventMap = {
  "session:start": [session: SessionFile];
  "session:end": [sessionId: string];
  "session:update": [session: SessionFile];
  "sessions:change": [sessions: SessionFile[]];
  "messages:new": [sessionId: string, lines: StoredLine[]];
  "permission:request": [sessionId: string, event: SessionEvent];
};

/**
 * Typed EventEmitter wrapper for type-safe pub/sub.
 */
class TypedEventEmitter<T extends Record<string, unknown[]>> {
  private emitter = new EventEmitter();

  on<K extends keyof T>(
    event: K,
    listener: (...args: T[K]) => void,
  ): () => void {
    this.emitter.on(event as string, listener as (...args: unknown[]) => void);
    return () => this.off(event, listener);
  }

  off<K extends keyof T>(event: K, listener: (...args: T[K]) => void): void {
    this.emitter.off(event as string, listener as (...args: unknown[]) => void);
  }

  emit<K extends keyof T>(event: K, ...args: T[K]): void {
    this.emitter.emit(event as string, ...args);
  }
}

/** Singleton event bus for daemon-wide events */
export const eventBus = new TypedEventEmitter<EventMap>();
