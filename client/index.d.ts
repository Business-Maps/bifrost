/**
 * Options for constructing a BifrostBrowser instance.
 */
export interface BifrostOptions {
  /** WebSocket server port. Default: 3099 */
  port?: number;
  /** Authentication token printed by the daemon on startup. */
  token?: string | null;
  /** Automatically reconnect when disconnected. Default: true */
  autoReconnect?: boolean;
  /** Milliseconds between reconnect attempts. Default: 3000 */
  reconnectInterval?: number;
}

/**
 * A tool that can be registered with the bridge and called by Claude Code.
 */
export interface BifrostTool {
  /** Unique tool name. */
  name: string;
  /** Human-readable description shown to the AI. */
  description: string;
  /** JSON Schema describing the tool's expected arguments. */
  inputSchema: Record<string, unknown>;
  /** Function invoked when the AI calls this tool. May be async. */
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}

/** Event names emitted by BifrostBrowser. */
export type BifrostEventName = "connected" | "disconnected" | "tool_call" | "error" | "pending";

/** Listener function for bridge events. */
export type BifrostEventListener = (...args: any[]) => void;

/**
 * Browser WebSocket client that connects to the Bifrost daemon,
 * registers tools, and dispatches tool calls to handlers.
 */
export declare class BifrostBrowser {
  /** WebSocket server port. */
  port: number;
  /** Authentication token, or null. */
  token: string | null;
  /** Whether auto-reconnect is enabled. */
  autoReconnect: boolean;
  /** Milliseconds between reconnect attempts. */
  reconnectInterval: number;
  /** The underlying WebSocket instance, or null when disconnected. */
  ws: WebSocket | null;
  /** Currently registered tools. */
  tools: BifrostTool[];

  constructor(options?: BifrostOptions);

  /** The computed WebSocket URL (ws://localhost:<port>). */
  get url(): string;

  /** Subscribe to an event. Returns `this` for chaining. */
  on(event: BifrostEventName, fn: BifrostEventListener): this;

  /** Unsubscribe from an event. Returns `this` for chaining. */
  off(event: BifrostEventName, fn: BifrostEventListener): this;

  /**
   * Register tools. Can be called before or after connect().
   * Re-calling replaces all previously registered tools.
   */
  registerTools(tools: BifrostTool[]): void;

  /** Open a WebSocket connection to the daemon. */
  connect(): void;

  /** Close the connection and disable auto-reconnect. */
  disconnect(): void;
}

export default BifrostBrowser;

declare global {
  interface Window {
    BifrostBrowser: typeof BifrostBrowser;
  }
}
