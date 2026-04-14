# Contributing to Bifrost

## Prerequisites

- Node.js 18+

## Dev Setup

```bash
git clone <your-fork>
cd mcp
npm install
```

## Running Locally

Start the daemon:

```bash
node bin/bifrost
```

Listens on port 3099 by default.

## Running Tests

```bash
npm test
```

Tests use Node's built-in test runner (`node:test`).

All code changes should include tests.

## End-to-End Testing

1. Start the daemon (`node bin/bifrost`)
2. Open `demo/index.html` in a browser
3. Connect to the daemon
4. Trigger tool calls from Claude Code and verify round-trip behavior

## Code Style

No linter is configured. Follow the existing style:

- 2-space indentation
- Double quotes
- Semicolons

## Submitting Changes

1. Fork the repo and create a branch off `main`
2. Make your changes and add tests
3. Run `npm test` and confirm everything passes
4. Open a PR against `main`
