# @businessmaps/bifrost

[![CI](https://github.com/Business-Maps/bifrost/actions/workflows/ci.yml/badge.svg)](https://github.com/Business-Maps/bifrost/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@businessmaps/bifrost)](https://www.npmjs.com/package/@businessmaps/bifrost)

MCP server that lets AI tools call functions running in your browser.

The daemon sits between any MCP client and your browser tab. It speaks JSON-RPC over stdio on one side and WebSocket on the other. Your browser app connects, registers tools, and the AI can call them.

## Quick start

### 1. Add to your AI tool

**Claude Code:**

```bash
claude mcp add --transport stdio bifrost -- npx @businessmaps/bifrost --no-auth
```

**Claude Desktop** - add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bifrost": {
      "command": "npx",
      "args": ["@businessmaps/bifrost", "--no-auth"]
    }
  }
}
```

**Cursor** - add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "bifrost": {
      "command": "npx",
      "args": ["@businessmaps/bifrost", "--no-auth"]
    }
  }
}
```

No install needed. `npx` downloads and runs the package automatically.

### 2. Add the client to your browser app

```bash
npm i @businessmaps/bifrost-browser
```

Or via CDN:

```html
<script src="https://unpkg.com/@businessmaps/bifrost-browser"></script>
```

TypeScript types are included.

### 3. Register tools

```js
import { BifrostBrowser } from "@businessmaps/bifrost-browser";

const bridge = new BifrostBrowser({ port: 3099 });

bridge.registerTools([
  {
    name: "get_page_title",
    description: "Returns the page title",
    inputSchema: { type: "object", properties: {} },
    handler: async () => document.title,
  },
  {
    name: "get_selection",
    description: "Returns the user's current text selection",
    inputSchema: { type: "object", properties: {} },
    handler: async () => window.getSelection().toString(),
  },
]);

bridge.connect();
```

That's it. The AI can now call `get_page_title` and `get_selection` in your browser tab. Handlers have full access to DOM, Canvas, IndexedDB, Clipboard, `fetch`, etc.

## Auth

By default the daemon generates a random token on startup. Two ways to get it:

- **Terminal mode** - the token prints to screen when the daemon starts
- **MCP mode** - the AI calls the built-in `bifrost_connection_info` tool to get the token, then tells you what to paste into your app

Pass the token to the client:

```js
const bridge = new BifrostBrowser({ port: 3099, token: "TOKEN" });
```

Skip auth entirely with `--no-auth` during local development.

## Multiple tabs

Each tab registers its own tools. Calls route to whoever owns the tool. Disconnecting a tab removes its tools.

## Options

```
--port <port>     WebSocket port        (default: 3099)
--timeout <secs>  Tool call timeout     (default: 120)
--no-auth         Disable token auth    (dev only)
--help, -h        Show this message
--version, -v     Show version
```

## Dev

```bash
git clone https://github.com/Business-Maps/bifrost.git && cd bifrost
npm install
npm test
```

[Architecture](docs/architecture.md) · [Client API](docs/client-api.md) · [Contributing](CONTRIBUTING.md)

## License

Apache 2.0
