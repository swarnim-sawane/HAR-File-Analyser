import io, { Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:4000';

type EventCallback = (data: any) => void;

class WebSocketClient {
  private socket: Socket | null = null;
  private sessionId: string;
  private eventHandlers: Map<string, Set<EventCallback>> = new Map();
  private pendingSubscriptions: Set<string> = new Set(); // ✅ NEW

  constructor() {
    this.sessionId = this.getSessionId();
  }

  private getSessionId(): string {
    return localStorage.getItem('sessionId')!;
  }

  connect(): void {
    if (this.socket?.connected) {
      console.log('WebSocket already connected');
      return;
    }

    this.socket = io(WS_URL, {
      transports: ['websocket', 'polling'],
      query: { sessionId: this.sessionId },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });

    this.socket.on('connect', () => {
      console.log('WebSocket connected:', this.socket?.id);
      this.emit('connect', {});

      // Re-subscribe to any files that were subscribed before reconnect
      this.pendingSubscriptions.forEach(fileId => {
        console.log('Re-subscribing to file:', fileId);
        this.socket?.emit('subscribe:file', fileId);
      });
    });

    this.socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      this.emit('disconnect', {});
    });

    this.socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
      this.emit('disconnect', {});
    });

    this.setupEventForwarding();
  }

  private setupEventForwarding(): void {
    if (!this.socket) return;

    // Upload progress
    this.socket.on('upload:progress', (data) => {
      this.emit('upload:progress', data);
    });

    // Processing progress
    this.socket.on('processing:progress', (data) => {
      this.emit('processing:progress', data);
    });

    // File status updates
    this.socket.on('file:status', (data) => {
      this.emit('file:status', data);
    });

    // Embedding progress
    this.socket.on('embedding:progress', (data) => {
      this.emit('embedding:progress', data);
    });

    // Indexing progress
    this.socket.on('indexing:progress', (data) => {
      this.emit('indexing:progress', data);
    });

    // AI event listeners
    this.socket.on('ai:stream', (data) => {
      this.emit('ai:stream', data);
    });

    this.socket.on('ai:complete', (data) => {
      this.emit('ai:complete', data);
    });

    this.socket.on('ai:error', (data) => {
      this.emit('ai:error', data);
    });
  }

  subscribeToFile(fileId: string): void {
    // ✅ NEW: Track subscription
    this.pendingSubscriptions.add(fileId);

    if (this.socket?.connected) {
      this.socket.emit('subscribe:file', fileId);
      console.log('Subscribed to file:', fileId);
    } else {
      console.warn('Socket not connected, will subscribe on connect');
    }
  }

  sendAiQuery(fileId: string, query: string): void {
    if (this.socket?.connected) {
      this.socket.emit('ai:query', { fileId, query, timestamp: Date.now() });
      console.log('AI query sent:', fileId, query);
    } else {
      console.error('WebSocket not connected, cannot send AI query');
      throw new Error('WebSocket not connected');
    }
  }

  on(event: string, callback: EventCallback): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(callback);
  }

  off(event: string, callback: EventCallback): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(callback);
    }
  }

  private emit(event: string, data: any): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(callback => callback(data));
    }
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.pendingSubscriptions.clear(); // ✅ NEW
    }
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }
}

export const wsClient = new WebSocketClient();
