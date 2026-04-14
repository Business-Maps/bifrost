// ============================================================================
// WebSocket server - thin wrapper around 'ws' for API compatibility
// ============================================================================

import { createServer } from "http";
import { EventEmitter } from "events";
import { WebSocketServer, WebSocket } from "ws";

// ---------------------------------------------------------------------------
// MiniWebSocket - wraps a ws.WebSocket with the same API the daemon expects
// ---------------------------------------------------------------------------
export class MiniWebSocket extends EventEmitter {
  constructor(ws) {
    super();
    this._ws = ws;
    this.readyState = 1;

    ws.on("message", (data) => {
      const text = typeof data === "string" ? data : data.toString();
      this.emit("message", text);
    });

    ws.on("close", () => {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.emit("close");
    });

    ws.on("error", (err) => {
      if (this.readyState !== 3) {
        this.readyState = 3;
        this.emit("close");
      }
      this.emit("error", err);
    });

    ws.on("pong", () => this.emit("pong"));
  }

  get socket() { return this._ws._socket || null; }
  get bufferedAmount() { return this._ws.bufferedAmount; }

  send(data) {
    if (this._ws.readyState !== WebSocket.OPEN) return;
    this._ws.send(typeof data === "string" ? data : String(data));
  }

  close(code = 1000) {
    if (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING) {
      this._ws.close(code);
    }
  }

  terminate() {
    this._ws.terminate();
  }
}

// ---------------------------------------------------------------------------
// MiniWebSocketServer - wraps ws.WebSocketServer, emits MiniWebSocket
// ---------------------------------------------------------------------------
export class MiniWebSocketServer extends EventEmitter {
  constructor({ port }, cb) {
    super();

    this.server = createServer((req, res) => {
      res.writeHead(426);
      res.end("Upgrade required");
    });

    this._wss = new WebSocketServer({
      server: this.server,
      perMessageDeflate: false,
    });

    this._wss.on("connection", (ws, req) => {
      this.emit("connection", new MiniWebSocket(ws), req);
    });

    this.server.listen(port, "127.0.0.1", cb);
  }

  close(cb) {
    this._wss.close();
    this.server.close(cb);
  }
}
