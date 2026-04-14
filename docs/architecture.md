# Bifrost -- Architecture

## Overview

Bifrost connects browser-based web applications to Claude Code through the Model Context Protocol (MCP). A single Node.js daemon acts as the bridge: it speaks MCP (JSON-RPC over stdio) on one side and WebSocket on the other, letting any browser tab expose tools that Claude Code can invoke.

## Components

```
+-----------------+         stdio          +-------------------------+       WebSocket        +---------------------+
|                 |   (MCP JSON-RPC)       |                         |    (localhost:PORT)    |                     |
|   Claude Code   | <--------------------> |  Daemon                 | <--------------------> |  Browser Client     |
|                 |   stdin / stdout       |  bin/bifrost            |  Sec-WebSocket-Proto   |  @businessmaps/     |
+-----------------+                        +-------------------------+                        |  bifrost-browser    |
                                                      ^                                       +---------------------+
                                                      |  WebSocket                                   |  JS API
                                                      |                                              v
                                                      |                                       +---------------------+
                                                      +-------------------------------------> |  Demo App           |
                                                         (additional tabs / connections)       |  docs/demo/         |
                                                                                              |  index.html         |
                                                                                              +---------------------+
```

### 1. Daemon (`bin/bifrost`)

Node.js script launched by Claude Code as an MCP server. Responsibilities:

- Reads MCP JSON-RPC requests from **stdin**, writes responses to **stdout**.
- Starts a WebSocket server on `localhost` (configured via `PORT` env var, default 3099).
- Generates a random authentication token on startup.
- Maintains a registry of tools reported by connected browser clients.
- Routes `tools/call` requests to the correct browser connection based on which connection registered the tool.
- Implements MCP `tools/list` by aggregating all registered tools across connections.
- Tool names are namespaced as `connId:toolName` to avoid collisions.

### 2. Browser Client (`@businessmaps/bifrost-browser`)

The `BifrostBrowser` class, loaded in the browser via npm or CDN. Ships with TypeScript types. Responsibilities:

- Connects to the daemon via WebSocket, authenticating with the `Sec-WebSocket-Protocol` header.
- Provides an API for registering tools (name, description, input schema, handler function).
- Sends a `register_tools` message to the daemon on connect.
- Listens for `tool_call` messages, executes the matching handler, and sends back `tool_result`.
- Responds to `ping` with `pong` to keep the connection alive.

### 3. Demo App (`docs/demo/index.html`)

A single-page HTML file that imports the bridge client from CDN and registers five sample tools to demonstrate the end-to-end flow. Hosted on GitHub Pages and serves as both a reference implementation and a manual test harness.

## Message Flow

A complete tool invocation follows this path:

```
1.  Claude Code decides to call tool "browser__get_selection"
2.  Claude Code sends a JSON-RPC `tools/call` request via stdin
3.  Daemon receives the request, parses the tool name
4.  Daemon looks up which WebSocket connection registered that tool
5.  Daemon sends a `tool_call` message over WebSocket to that connection
6.  Browser client receives the message, invokes the registered handler
7.  Handler executes (e.g., reads window.getSelection()) and returns a value
8.  Browser client sends a `tool_result` message back over WebSocket
9.  Daemon receives the result, wraps it in a JSON-RPC response
10. Daemon writes the response to stdout
11. Claude Code receives the tool result
```

## WebSocket Protocol

All messages are JSON objects with a `type` field. The protocol is intentionally minimal.

### `register_tools` (browser -> daemon)

Sent immediately after the WebSocket connection opens. Declares the tools this connection provides.

```json
{
  "type": "register_tools",
  "version": "1",
  "tools": [
    {
      "name": "get_page_title",
      "description": "Returns the current page title",
      "inputSchema": {
        "type": "object",
        "properties": {},
        "required": []
      }
    }
  ]
}
```

### `tool_call` (daemon -> browser)

Sent when Claude Code invokes a tool registered by this connection.

```json
{
  "type": "tool_call",
  "callId": "call_1",
  "name": "get_page_title",
  "arguments": {}
}
```

### `tool_result` (browser -> daemon)

Sent in response to a `tool_call`. Includes either a `result` or an `error`, never both.

Success:

```json
{
  "type": "tool_result",
  "callId": "call_1",
  "result": "My Page Title"
}
```

Failure:

```json
{
  "type": "tool_result",
  "callId": "call_1",
  "error": "No active selection"
}
```

### `ping` / `pong` (heartbeat)

The daemon periodically sends a `ping`. The browser client must respond with `pong` to avoid being disconnected.

```json
{ "type": "ping" }
```

```json
{ "type": "pong" }
```

## Multi-Connection Model

Multiple browser tabs (or different web apps) can connect to the daemon simultaneously.

- **Namespaced tools**: Tool names are prefixed with the connection ID (e.g., `conn_1:get_page_title`). This prevents collisions when multiple connections register tools with the same name.
- **Routing**: When Claude Code calls a tool, the daemon looks up which connection registered that tool name and forwards the `tool_call` to that connection.
- **Disconnection**: When a connection closes, its tools are removed from the registry, a `tools/list_changed` notification is sent, and any pending tool calls for that connection are cleaned up.

## Authentication

On startup the daemon generates a cryptographically random token (via `crypto.randomBytes`). The token is passed during the WebSocket handshake via the `Sec-WebSocket-Protocol` header:

```js
new WebSocket("ws://localhost:3099", token);
```

Any connection attempt without a valid token is rejected immediately. The token is printed to stderr on startup so that the browser client or launch script can pick it up.

This prevents other local processes from connecting to the daemon and registering rogue tools. Additionally, the daemon validates the `Origin` header and only accepts connections from `localhost` / `127.0.0.1`.

## Design Rationale

| Decision | Why |
|---|---|
| **Minimal dependencies** | The daemon depends only on [`ws`](https://github.com/websockets/ws) for WebSocket support. Keeping the dependency tree small reduces supply-chain risk and version conflicts. |
| **Single daemon process** | One process handles both stdio (MCP) and WebSocket (browser). No IPC between separate processes, no port coordination, no process management. Claude Code launches it like any other MCP server. |
| **Stdio transport** | MCP's stdio transport is the simplest integration path with Claude Code. The daemon is just a child process; no HTTP server or SSE required on the MCP side. |

## Known Limitations

- **Localhost only**: The WebSocket server binds to `127.0.0.1`. Remote connections are not supported by design.
- **No TLS**: The WebSocket connection is `ws://`, not `wss://`. Acceptable on localhost; would need a reverse proxy or TLS termination for any non-local use.
- **Single token auth**: All connections share one static token for the lifetime of the daemon process. There is no per-connection or per-user auth.
