# Bifrost Browser Client API Reference

Client library for connecting browser applications to the Bifrost daemon.

**npm**: [`@businessmaps/bifrost-browser`](https://www.npmjs.com/package/@businessmaps/bifrost-browser)

---

## Loading the Library

**npm** (recommended for bundled apps):

```bash
npm i @businessmaps/bifrost-browser
```

```js
import { BifrostBrowser } from "@businessmaps/bifrost-browser";
```

TypeScript types are included - no `@types` package needed.

**CDN** (script tag, sets `window.BifrostBrowser`):

```html
<script src="https://unpkg.com/@businessmaps/bifrost-browser"></script>
```

**CommonJS**:

```js
const { BifrostBrowser } = require("@businessmaps/bifrost-browser");
```

---

## `BifrostBrowser` Class

### Constructor

```js
const bridge = new BifrostBrowser(options);
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `3099` | WebSocket server port |
| `token` | `string` | `undefined` | Authentication token (printed by daemon on startup) |
| `autoReconnect` | `boolean` | `true` | Automatically reconnect when disconnected |
| `reconnectInterval` | `number` | `3000` | Milliseconds between reconnect attempts |

---

### Methods

#### `registerTools(tools)`

Register an array of tool objects. Can be called before or after `connect()`. Re-calling replaces all previously registered tools.

Each tool object has the following shape:

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Unique tool name |
| `description` | `string` | Human-readable description |
| `inputSchema` | `object` | JSON Schema describing the tool's arguments |
| `handler` | `async (args) => any` | Function invoked when Claude Code calls the tool |

```js
bridge.registerTools([
  {
    name: "get_page_title",
    description: "Returns the current page title",
    inputSchema: { type: "object", properties: {} },
    handler: async () => document.title,
  },
  {
    name: "click_element",
    description: "Click an element by CSS selector",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector" },
      },
      required: ["selector"],
    },
    handler: async ({ selector }) => {
      document.querySelector(selector)?.click();
      return "clicked";
    },
  },
]);
```

#### `connect()`

Open a WebSocket connection to the daemon. The token is sent via the `Sec-WebSocket-Protocol` header.

```js
bridge.connect();
```

#### `disconnect()`

Close the connection and disable auto-reconnect.

```js
bridge.disconnect();
```

---

### Events

Subscribe with `.on(event, fn)` and unsubscribe with `.off(event, fn)`.

| Event | Payload | Description |
|-------|---------|-------------|
| `connected` | none | WebSocket connection opened |
| `disconnected` | none | WebSocket connection closed (auto-reconnect retries if enabled) |
| `tool_call` | raw message | A tool was invoked by Claude Code |
| `error` | error object | WebSocket error occurred |

```js
bridge.on("connected", () => console.log("Connected to daemon"));
bridge.on("disconnected", () => console.log("Disconnected"));
bridge.on("error", (err) => console.error("Bridge error:", err));
bridge.on("tool_call", (msg) => console.log("Tool called:", msg));
```

---

### Tool Handler Contract

- Receives an `arguments` object matching the tool's `inputSchema`.
- Must return a `string` or any JSON-serializable value.
- May be `async` (return a `Promise`).
- Errors thrown inside a handler are forwarded to Claude Code as error results.

```js
handler: async (args) => {
  if (!args.selector) throw new Error("selector is required");
  const el = document.querySelector(args.selector);
  if (!el) throw new Error(`No element found for: ${args.selector}`);
  return el.textContent;
}
```

---

## TypeScript

The package ships with full type definitions. Key exported types:

```ts
import {
  BifrostBrowser,
  BifrostOptions,
  BifrostTool,
  BifrostEventName,
  BifrostEventListener,
} from "@businessmaps/bifrost-browser";
```

| Type | Description |
|------|-------------|
| `BifrostOptions` | Constructor options (`port`, `token`, `autoReconnect`, `reconnectInterval`) |
| `BifrostTool` | Tool definition (`name`, `description`, `inputSchema`, `handler`) |
| `BifrostEventName` | `"connected" \| "disconnected" \| "tool_call" \| "error"` |
| `BifrostEventListener` | `(...args: any[]) => void` |

`window.BifrostBrowser` is also typed for CDN/script-tag usage.

---

## Full Example

```js
import { BifrostBrowser } from "@businessmaps/bifrost-browser";

const bridge = new BifrostBrowser({
  port: 3099,
  token: "abc123",
});

bridge.registerTools([
  {
    name: "get_page_html",
    description: "Return the full page HTML",
    inputSchema: { type: "object", properties: {} },
    handler: async () => document.documentElement.outerHTML,
  },
]);

bridge.on("connected", () => console.log("Ready"));
bridge.on("error", (err) => console.error(err));

bridge.connect();
```
