import type { Conversation } from "../conversations/registry.ts";

export type MetaBroadcastMessage =
  | { kind: "conversation_meta_updated"; conversation: Conversation }
  | { kind: "conversation_deleted"; conversation_id: string };

export type MetaListener = (message: MetaBroadcastMessage) => void;

export class MetaBroadcaster {
  private readonly subscribers = new Map<string, Set<MetaListener>>();

  subscribe(conversationId: string, listener: MetaListener): () => void {
    let group = this.subscribers.get(conversationId);
    if (!group) {
      group = new Set();
      this.subscribers.set(conversationId, group);
    }
    group.add(listener);
    return () => {
      const g = this.subscribers.get(conversationId);
      if (!g) return;
      g.delete(listener);
      if (g.size === 0) this.subscribers.delete(conversationId);
    };
  }

  broadcast(conversationId: string, message: MetaBroadcastMessage): void {
    const group = this.subscribers.get(conversationId);
    if (!group) return;
    for (const listener of group) {
      try {
        listener(message);
      } catch {
        // listener errors must not interrupt other listeners
      }
    }
  }
}
