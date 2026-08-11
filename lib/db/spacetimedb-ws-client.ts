type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer?: ReturnType<typeof setTimeout>;
};

type ConnectionState = "disconnected" | "connecting" | "connected";

type MessageHandler = (msg: any) => void;

let nextConnectionId = 1;

export class SpacetimeDbWsClient {
  private ws: WebSocket | null = null;
  private baseUrl = "";
  private database = "";
  private token?: string;
  private identity: string | null = null;
  private connToken: string | null = null;
  private connectionId: string | null = null;
  private state: ConnectionState = "disconnected";
  private pendingOneOffs = new Map<string, PendingRequest>();
  private pendingReducers = new Map<number, PendingRequest>();
  private msgIdCounter = 0;
  private reqIdCounter = 0;
  private messageHandlers = new Set<MessageHandler>();
  private onConnectedHandlers: Array<() => void> = [];
  private connectPromise: Promise<void> | null = null;
  private connLabel: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(baseUrl: string, database: string, token?: string) {
    this.baseUrl = baseUrl.replace(/^http/, "ws");
    this.database = database;
    this.token = token;
    this.connLabel = `${database}@${baseUrl}`;
  }

  get isConnected(): boolean {
    return this.state === "connected";
  }

  get hasIdentity(): boolean {
    return this.identity !== null;
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  private nextMsgId(): string {
    this.msgIdCounter++;
    return this.msgIdCounter.toString(16).padStart(8, "0");
  }

  private nextReqId(): number {
    this.reqIdCounter++;
    return this.reqIdCounter;
  }

  async connect(): Promise<void> {
    if (this.state === "connected") return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this.doConnect();
    return this.connectPromise;
  }

  private async doConnect(): Promise<void> {
    if (this.state === "connecting" || this.state === "connected") return;

    this.state = "connecting";
    const wsUrl = new URL(this.baseUrl.replace(/^ws/, "http"));
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    wsUrl.pathname = `/database/${encodeURIComponent(this.database)}`;

    const rawConnId = `gen-${nextConnectionId++}-${Date.now().toString(36)}`;
    wsUrl.searchParams.set("connection_id", rawConnId);
    wsUrl.searchParams.set("compression", "none");
    if (this.token) wsUrl.searchParams.set("token", this.token);

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.state === "connecting") {
          this.state = "disconnected";
          reject(new Error("SpacetimeDB WS: connection timeout"));
        }
      }, 10000);

      try {
        const ws = new WebSocket(wsUrl.toString(), "v1.json.spacetimedb");
        this.ws = ws;

        ws.onopen = () => {
          console.debug(`[SpacetimeDB WS] Connected to ${this.connLabel}`);
        };

        ws.onmessage = (event: MessageEvent) => {
          let msg: any;
          try {
            msg = typeof event.data === "string"
              ? JSON.parse(event.data)
              : JSON.parse(new TextDecoder().decode(event.data as ArrayBuffer));
          } catch {
            console.warn("[SpacetimeDB WS] Failed to parse message:", event.data);
            return;
          }

          const variant = Object.keys(msg)[0];
          const payload = msg[variant];

          if (variant === "IdentityToken") {
            clearTimeout(timeout);
            this.identity = payload.identity;
            this.connToken = payload.token || null;
            this.connectionId = payload.connection_id || null;
            this.state = "connected";
            console.debug(`[SpacetimeDB WS] Identity: ${this.identity}`);
            for (const cb of this.onConnectedHandlers) cb();
            this.onConnectedHandlers = [];
            resolve();
          } else if (variant === "OneOffQueryResponse") {
            const idHex = this.encodeMsgId(payload.message_id);
            const pending = this.pendingOneOffs.get(idHex);
            if (pending) {
              clearTimeout(pending.timer);
              this.pendingOneOffs.delete(idHex);
              if (payload.error) {
                pending.reject(new Error(payload.error));
              } else {
                pending.resolve(payload);
              }
            }
          } else if (variant === "TransactionUpdate") {
            const reqId = payload.reducer_call?.request_id;
            if (reqId !== undefined) {
              const pending = this.pendingReducers.get(reqId);
              if (pending) {
                clearTimeout(pending.timer);
                this.pendingReducers.delete(reqId);
                if (payload.status?.Committed) {
                  pending.resolve(payload);
                } else if (payload.status?.Failed) {
                  pending.reject(new Error(payload.status.Failed));
                } else if (payload.status?.OutOfEnergy) {
                  pending.reject(new Error("Out of energy"));
                } else {
                  pending.resolve(payload);
                }
              }
            }
          } else if (variant === "InitialSubscription") {
            // Initial subscription data — ignore for now
          } else if (variant === "SubscribeApplied") {
            // Sub applied — ignore for now
          }

          for (const handler of this.messageHandlers) {
            try { handler(msg); } catch { }
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          if (this.state === "connecting") {
            this.state = "disconnected";
            reject(new Error(`SpacetimeDB WS: connection failed for ${this.connLabel}`));
          }
        };

        ws.onclose = () => {
          this.state = "disconnected";
          this.identity = null;
          // Reject any pending requests
          for (const [_, pending] of this.pendingOneOffs) {
            clearTimeout(pending.timer);
            pending.reject(new Error("Connection closed"));
          }
          this.pendingOneOffs.clear();
          for (const [_, pending] of this.pendingReducers) {
            clearTimeout(pending.timer);
            pending.reject(new Error("Connection closed"));
          }
          this.pendingReducers.clear();
          this.scheduleReconnect();
        };
      } catch (err) {
        clearTimeout(timeout);
        this.state = "disconnected";
        reject(err);
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectPromise = null;
      this.state = "disconnected";
      this.connect().catch(() => { });
    }, 3000);
  }

  private encodeMsgId(msgId: any): string {
    if (typeof msgId === "string") return msgId;
    if (Array.isArray(msgId)) {
      return Array.from(msgId).map((b: number) => b.toString(16).padStart(2, "0")).join("");
    }
    if (msgId && typeof msgId === "object") {
      try { return JSON.stringify(msgId); } catch { return String(msgId); }
    }
    return String(msgId);
  }

  private sendJson(msg: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("SpacetimeDB WS: not connected");
    }
    this.ws.send(JSON.stringify(msg));
  }

  async executeQuery(sql: string): Promise<{ tables: Array<{ table_name: string; rows: string[] }> }> {
    await this.ensureConnected();
    const msgIdHex = this.nextMsgId();
    const msgIdBytes = Array.from(new TextEncoder().encode(msgIdHex));
    const message = {
      OneOffQuery: {
        message_id: msgIdBytes,
        query_string: sql,
      },
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingOneOffs.delete(msgIdHex);
        reject(new Error(`SpacetimeDB WS: query timeout for ${sql.substring(0, 50)}`));
      }, 30000);

      this.pendingOneOffs.set(msgIdHex, { resolve, reject, timer });
      try {
        this.sendJson(message);
      } catch (err) {
        clearTimeout(timer);
        this.pendingOneOffs.delete(msgIdHex);
        reject(err);
      }
    });
  }

  async callReducer(reducer: string, args: any[]): Promise<any> {
    await this.ensureConnected();
    const requestId = this.nextReqId();
    const argsJson = JSON.stringify(args);
    const message = {
      CallReducer: {
        reducer,
        args: argsJson,
        request_id: requestId,
        flags: 0,
      },
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingReducers.delete(requestId);
        reject(new Error(`SpacetimeDB WS: reducer '${reducer}' timeout`));
      }, 60000);

      this.pendingReducers.set(requestId, { resolve, reject, timer });
      try {
        this.sendJson(message);
      } catch (err) {
        clearTimeout(timer);
        this.pendingReducers.delete(requestId);
        reject(err);
      }
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.onConnectedHandlers = [];
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.state = "disconnected";
    this.identity = null;
  }

  private async ensureConnected(): Promise<void> {
    if (this.state === "connected") return;
    if (this.state === "connecting") {
      await this.connectPromise;
      return;
    }
    this.connectPromise = null;
    await this.connect();
  }
}

const wsClients = new Map<string, SpacetimeDbWsClient>();

export function getWsClient(
  baseUrl: string,
  database: string,
  token?: string,
): SpacetimeDbWsClient {
  const key = `${database}@${baseUrl}`;
  let client = wsClients.get(key);
  if (!client) {
    client = new SpacetimeDbWsClient(baseUrl, database, token);
    wsClients.set(key, client);
  }
  return client;
}

export function closeAllWsClients(): void {
  for (const [_, client] of wsClients) {
    client.disconnect();
  }
  wsClients.clear();
}
