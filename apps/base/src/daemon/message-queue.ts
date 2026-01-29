/**
 * Per-client message queue manager for flow control.
 *
 * Ensures batches are sent one at a time per client, waiting for
 * acknowledgment before sending the next batch.
 *
 * No timeout logic - TCP guarantees delivery or disconnect.
 * On disconnect, queue is cleared and client will reconnect with
 * cursor to catch up from where it left off.
 */

import type { RawMessagesBatchPayload } from "@arc0/types";

export interface QueuedBatch {
  payload: RawMessagesBatchPayload;
  encrypted: boolean;
  resolve?: () => void; // For async waiting
}

interface ClientQueue {
  pending: QueuedBatch[];
  inFlight: QueuedBatch | null;
}

export type EmitFn = (
  socketId: string,
  payload: RawMessagesBatchPayload,
  encrypted: boolean,
  onAck: () => void
) => boolean;

export class MessageQueueManager {
  private queues = new Map<string, ClientQueue>();
  private emitFn: EmitFn;

  constructor(emitFn: EmitFn) {
    this.emitFn = emitFn;
  }

  private getQueue(socketId: string): ClientQueue {
    let queue = this.queues.get(socketId);
    if (!queue) {
      queue = { pending: [], inFlight: null };
      this.queues.set(socketId, queue);
    }
    return queue;
  }

  /**
   * Queue a message batch for a client. Will send immediately if nothing in flight.
   */
  enqueue(socketId: string, batch: QueuedBatch): void {
    const queue = this.getQueue(socketId);
    queue.pending.push(batch);
    this.trySend(socketId);
  }

  /**
   * Called when ack received from client. Clears in-flight and sends next.
   */
  onAck(socketId: string): void {
    const queue = this.queues.get(socketId);
    if (!queue) return;

    // Resolve promise if waiting
    if (queue.inFlight?.resolve) {
      queue.inFlight.resolve();
    }

    // Clear in-flight
    queue.inFlight = null;

    // Send next if available
    this.trySend(socketId);
  }

  /**
   * Called when client disconnects. Clears queue and resolves pending promises.
   */
  onDisconnect(socketId: string): void {
    const queue = this.queues.get(socketId);
    if (queue) {
      // Resolve any pending promises to unblock waiters
      if (queue.inFlight?.resolve) {
        queue.inFlight.resolve();
      }
      for (const batch of queue.pending) {
        if (batch.resolve) batch.resolve();
      }
    }
    this.queues.delete(socketId);
    console.log(`[message-queue] Cleared queue for disconnected client: ${socketId}`);
  }

  /**
   * Try to send next batch if nothing in flight.
   */
  private trySend(socketId: string): void {
    const queue = this.queues.get(socketId);
    if (!queue) return;

    // Don't send if already in flight
    if (queue.inFlight) return;

    // Get next batch
    const batch = queue.pending.shift();
    if (!batch) return;

    // Mark as in flight
    queue.inFlight = batch;

    // Emit with ack callback
    const sent = this.emitFn(socketId, batch.payload, batch.encrypted, () =>
      this.onAck(socketId)
    );

    if (!sent) {
      // Socket gone, clear queue
      this.onDisconnect(socketId);
      return;
    }

    console.log(
      `[message-queue] Sent batch to ${socketId} (${batch.payload.messages.length} messages), pending=${queue.pending.length}`
    );
  }

  /**
   * Get queue stats for monitoring.
   */
  getStats(): Map<string, { pending: number; inFlight: boolean }> {
    const stats = new Map<string, { pending: number; inFlight: boolean }>();
    for (const [socketId, queue] of this.queues) {
      stats.set(socketId, {
        pending: queue.pending.length,
        inFlight: queue.inFlight !== null,
      });
    }
    return stats;
  }

  /**
   * Cleanup (no-op, kept for interface compatibility).
   */
  stop(): void {
    // No interval to clear - TCP handles delivery/disconnect
  }
}
