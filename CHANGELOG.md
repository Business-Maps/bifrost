# Changelog

## v0.0.1 (2026-03-27)

Initial release.

### Features

- MCP stdio bridge
- WebSocket server (via [`ws`](https://github.com/websockets/ws))
- Browser client library (`@businessmaps/bifrost-browser`)
- Multi-connection support with namespaced tools
- Token authentication via `Sec-WebSocket-Protocol` header
- Origin validation (localhost only)
- Rate limiting (120 calls/min per connection)
- Heartbeat/keepalive (30s interval, 10s timeout)
- Message size limits and buffer overflow protection
- Frame fragmentation support
- Auto-reconnect in browser client
- Full TypeScript definitions
- Dual ESM/CommonJS client builds
