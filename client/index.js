class BifrostBrowser {
  constructor({ port = 3099, token, autoReconnect = true, reconnectInterval = 3000 } = {}) {
    this.port = port;
    this.token = token || null;
    this.autoReconnect = autoReconnect;
    this.reconnectInterval = reconnectInterval;
    this.ws = null;
    this.tools = [];
    this.handlers = {};
    this._listeners = {
      connected: [],
      disconnected: [],
      tool_call: [],
      error: [],
      pending: [],
    };
  }

  get url() {
    const base = `ws://localhost:${this.port}`;
    return this.token ? `${base}?token=${encodeURIComponent(this.token)}` : base;
  }

  on(event, fn) {
    (this._listeners[event] || (this._listeners[event] = [])).push(fn);
    return this;
  }

  off(event, fn) {
    this._listeners[event] = (this._listeners[event] || []).filter((f) => f !== fn);
    return this;
  }

  _emit(event, ...args) {
    (this._listeners[event] || []).forEach((fn) => fn(...args));
  }

  registerTools(tools) {
    this.tools = tools;
    this.handlers = {};
    for (const tool of tools) {
      this.handlers[tool.name] = tool.handler;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._sendRegistration();
    }
  }

  connect() {
    if (this.ws) {
      this.ws.close();
    }

    this.ws = new WebSocket(this.url);

    this.ws.addEventListener("open", () => {
      if (this.token) {
        // Token provided — emit connected immediately for backward compat
        this._emit("connected");
        this._sendRegistration();
      }
      // If no token, wait for welcome or pending_approval from daemon
    });

    this.ws.addEventListener("message", (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      this._handleMessage(msg);
    });

    this.ws.addEventListener("close", () => {
      this._emit("disconnected");
      if (this.autoReconnect) {
        setTimeout(() => this.connect(), this.reconnectInterval);
      }
    });

    this.ws.addEventListener("error", (err) => {
      this._emit("error", err);
    });
  }

  disconnect() {
    this.autoReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  _sendRegistration() {
    this._send({
      type: "register_tools",
      version: "1",
      tools: this.tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
    });
  }

  _send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  async _handleMessage(msg) {
    if (msg.type === "tool_call") {
      this._emit("tool_call", msg);

      const handler = this.handlers[msg.name];
      if (!handler) {
        this._send({ type: "tool_result", callId: msg.callId, error: `Unknown tool: ${msg.name}` });
        return;
      }

      try {
        const result = await handler(msg.arguments || {});
        this._send({ type: "tool_result", callId: msg.callId, result });
      } catch (err) {
        this._send({ type: "tool_result", callId: msg.callId, error: err.message || String(err) });
      }
      return;
    }

    if (msg.type === "welcome") {
      if (!this.token) {
        // Tokenless flow — daemon accepted us (--no-auth mode)
        this._emit("connected");
        this._sendRegistration();
      }
      return;
    }

    if (msg.type === "pending_approval") {
      this._emit("pending", { connectionId: msg.connectionId });
      return;
    }

    if (msg.type === "approved") {
      this._emit("connected");
      this._sendRegistration();
      return;
    }

    if (msg.type === "rejected") {
      this._emit("error", new Error(msg.reason || "Connection rejected"));
      return;
    }

    if (msg.type === "ping") {
      this._send({ type: "pong" });
    }
  }
}

// ESM
export { BifrostBrowser };
export default BifrostBrowser;

// Browser global
if (typeof window !== "undefined") {
  window.BifrostBrowser = BifrostBrowser;
}
