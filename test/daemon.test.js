import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import WebSocket from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_PATH = join(__dirname, "..", "bin", "bifrost");

let portCounter = 0;
function nextPort() {
  if (portCounter === 0) portCounter = 40000 + Math.floor(Math.random() * 10000);
  return portCounter++;
}

// Wrap a ws WebSocket with queued readMessage() for test convenience
function wrapWs(ws) {
  const messages = [];
  const waiters = [];

  ws.on("message", (data) => {
    const parsed = JSON.parse(data.toString());
    if (waiters.length > 0) {
      waiters.shift()(parsed);
    } else {
      messages.push(parsed);
    }
  });

  return {
    send(msg) { ws.send(JSON.stringify(msg)); },
    readMessage(timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        if (messages.length > 0) { resolve(messages.shift()); return; }
        const timer = setTimeout(() => {
          const idx = waiters.indexOf(handler);
          if (idx !== -1) waiters.splice(idx, 1);
          reject(new Error(`readMessage timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        function handler(val) { clearTimeout(timer); resolve(val); }
        waiters.push(handler);
      });
    },
    close() { ws.close(); },
    terminate() { ws.terminate(); },
  };
}

function spawnDaemon(port) {
  const proc = spawn("node", [DAEMON_PATH, "--port", String(port), "--no-auth"], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdoutBuf = "";
  const lines = [];
  const waiters = [];

  proc.stdout.on("data", (chunk) => {
    stdoutBuf += chunk;
    let idx;
    while ((idx = stdoutBuf.indexOf("\n")) !== -1) {
      const line = stdoutBuf.slice(0, idx);
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      let parsed;
      try { parsed = JSON.parse(line); } catch { continue; }
      if (waiters.length > 0) {
        waiters.shift()(parsed);
      } else {
        lines.push(parsed);
      }
    }
  });

  function send(msg) {
    proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  function readLine(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      if (lines.length > 0) {
        resolve(lines.shift());
        return;
      }
      const timer = setTimeout(() => {
        const idx = waiters.indexOf(handler);
        if (idx !== -1) waiters.splice(idx, 1);
        reject(new Error(`readLine timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      function handler(val) {
        clearTimeout(timer);
        resolve(val);
      }
      waiters.push(handler);
    });
  }

  const ready = new Promise((resolve) => {
    proc.stderr.on("data", function handler(chunk) {
      if (chunk.toString().includes("Secure MCP bridge running")) {
        proc.stderr.removeListener("data", handler);
        resolve();
      }
    });
  });

  async function wsConnect() {
    await ready;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.on("open", () => {
        const wrapped = wrapWs(ws);
        // Drain the welcome message sent by acceptConnection
        wrapped.readMessage().then(() => resolve(wrapped));
      });
      ws.on("error", reject);
    });
  }

  function kill() {
    proc.stdin.end();
    proc.kill("SIGKILL");
  }

  return { proc, send, readLine, wsConnect, kill, ready };
}

// ============================================================================
// MCP protocol tests
// ============================================================================

describe("Daemon MCP protocol", () => {
  let daemon;
  const port = nextPort();

  before(async () => {
    daemon = spawnDaemon(port);
    await daemon.ready;
  });

  after(() => daemon.kill());

  it("responds to initialize", async () => {
    daemon.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const res = await daemon.readLine();
    assert.equal(res.jsonrpc, "2.0");
    assert.equal(res.id, 1);
    assert.equal(res.result.protocolVersion, "2024-11-05");
    assert.equal(res.result.serverInfo.name, "bifrost");
    assert.ok(res.result.capabilities.tools.listChanged);
  });

  it("returns empty tools list with no browser connected", async () => {
    daemon.send({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
    const res = await daemon.readLine();
    assert.equal(res.id, 3);
    // Only the built-in tools should be present
    assert.equal(res.result.tools.length, 2);
    assert.equal(res.result.tools[0].name, "bifrost_connection_info");
    assert.equal(res.result.tools[1].name, "bifrost_approve");
  });

  it("returns error for tools/call with no browser connected", async () => {
    daemon.send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "x:test_tool", arguments: {} } });
    const res = await daemon.readLine();
    assert.equal(res.id, 5);
    assert.equal(res.error.code, -32000);
    assert.ok(res.error.message.includes("Tool not found"));
  });
});

// ============================================================================
// Tool registration and call tests
// ============================================================================

describe("Daemon tool registration and calls", () => {
  let daemon, browser;
  const port = nextPort();

  before(async () => {
    daemon = spawnDaemon(port);
    browser = await daemon.wsConnect();
  });

  after(() => {
    browser.close();
    daemon.kill();
  });

  it("registers tools from browser and notifies MCP", async () => {
    browser.send({
      type: "register_tools",
      tools: [
        { name: "greet", description: "Say hello", inputSchema: { type: "object", properties: { name: { type: "string" } } } },
        { name: "add", description: "Add numbers", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } } },
      ],
    });

    const notification = await daemon.readLine();
    assert.equal(notification.method, "notifications/tools/list_changed");
  });

  it("lists registered tools via MCP (namespaced with connection ID)", async () => {
    daemon.send({ jsonrpc: "2.0", id: 10, method: "tools/list", params: {} });
    const res = await daemon.readLine();
    // Built-in tools (2) + 2 browser tools
    assert.equal(res.result.tools.length, 4);
    const names = res.result.tools.map((t) => t.name);
    assert.equal(names[0], "bifrost_connection_info");
    assert.equal(names[1], "bifrost_approve");
    assert.ok(names[2].endsWith(":greet"), `Expected namespaced greet, got ${names[2]}`);
    assert.ok(names[3].endsWith(":add"), `Expected namespaced add, got ${names[3]}`);
  });

  it("forwards tool calls to browser and returns results", async () => {
    daemon.send({ jsonrpc: "2.0", id: 100, method: "tools/list", params: {} });
    const listRes = await daemon.readLine();
    const greetName = listRes.result.tools.find((t) => t.name.endsWith(":greet")).name;

    daemon.send({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: greetName, arguments: { name: "World" } } });

    const call = await browser.readMessage();
    assert.equal(call.type, "tool_call");
    assert.equal(call.name, "greet");
    assert.deepEqual(call.arguments, { name: "World" });

    browser.send({ type: "tool_result", callId: call.callId, result: "Hello, World!" });

    const res = await daemon.readLine();
    assert.equal(res.id, 11);
    assert.equal(res.result.content[0].text, '"Hello, World!"');
  });

  it("forwards object results as JSON strings", async () => {
    daemon.send({ jsonrpc: "2.0", id: 100, method: "tools/list", params: {} });
    const listRes = await daemon.readLine();
    const addName = listRes.result.tools.find((t) => t.name.endsWith(":add")).name;

    daemon.send({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: addName, arguments: { a: 2, b: 3 } } });

    const call = await browser.readMessage();
    browser.send({ type: "tool_result", callId: call.callId, result: { sum: 5 } });

    const res = await daemon.readLine();
    assert.equal(res.id, 12);
    assert.equal(res.result.content[0].text, '{"sum":5}');
  });

  it("returns tool errors to MCP", async () => {
    daemon.send({ jsonrpc: "2.0", id: 100, method: "tools/list", params: {} });
    const listRes = await daemon.readLine();
    const greetName = listRes.result.tools.find((t) => t.name.endsWith(":greet")).name;

    daemon.send({ jsonrpc: "2.0", id: 13, method: "tools/call", params: { name: greetName, arguments: {} } });

    const call = await browser.readMessage();
    browser.send({ type: "tool_result", callId: call.callId, error: "Something went wrong" });

    const res = await daemon.readLine();
    assert.equal(res.id, 13);
    assert.equal(res.result.content[0].text, '"Something went wrong"');
  });
});

// ============================================================================
// Browser disconnect tests
// ============================================================================

it("cleans up and notifies when browser disconnects", async () => {
  const port = nextPort();
  const daemon = spawnDaemon(port);
  const browser = await daemon.wsConnect();

  browser.send({ type: "register_tools", tools: [{ name: "slow_tool", description: "Slow" }] });
  await daemon.readLine(); // tools/list_changed

  browser.terminate();

  const notification = await daemon.readLine(5000);
  assert.equal(notification.method, "notifications/tools/list_changed");

  daemon.send({ jsonrpc: "2.0", id: 50, method: "tools/list", params: {} });
  const res = await daemon.readLine();
  assert.equal(res.id, 50);
  // Only the built-in tools remain after browser disconnect
  assert.equal(res.result.tools.length, 2);
  assert.equal(res.result.tools[0].name, "bifrost_connection_info");
  assert.equal(res.result.tools[1].name, "bifrost_approve");

  daemon.kill();
});

// ============================================================================
// Authentication tests
// ============================================================================

describe("Daemon authentication", () => {
  let proc, port, token;
  let stdoutBuf = "";
  const stdoutLines = [];
  const stdoutWaiters = [];

  function sendMcp(msg) {
    proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  function readMcp(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      if (stdoutLines.length > 0) { resolve(stdoutLines.shift()); return; }
      const timer = setTimeout(() => {
        const idx = stdoutWaiters.indexOf(handler);
        if (idx !== -1) stdoutWaiters.splice(idx, 1);
        reject(new Error(`readMcp timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      function handler(val) { clearTimeout(timer); resolve(val); }
      stdoutWaiters.push(handler);
    });
  }

  before(async () => {
    port = nextPort();
    proc = spawn("node", [DAEMON_PATH, "--port", String(port)], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.stdout.on("data", (chunk) => {
      stdoutBuf += chunk;
      let idx;
      while ((idx = stdoutBuf.indexOf("\n")) !== -1) {
        const line = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (!line) continue;
        let parsed;
        try { parsed = JSON.parse(line); } catch { continue; }
        if (stdoutWaiters.length > 0) { stdoutWaiters.shift()(parsed); }
        else { stdoutLines.push(parsed); }
      }
    });

    token = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for daemon")), 5000);
      let buf = "";
      proc.stderr.on("data", (chunk) => {
        buf += chunk.toString();
        const match = buf.match(/Auth token \(use as header\): (\S+)/);
        if (match && buf.includes("Secure MCP bridge running")) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      });
    });
  });

  after(() => {
    proc.stdin.end();
    proc.kill("SIGKILL");
  });

  it("places tokenless connections in pending state", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const msg = await new Promise((resolve, reject) => {
      ws.on("message", (data) => resolve(JSON.parse(data.toString())));
      ws.on("close", () => reject(new Error("Connection was closed instead of pending")));
      ws.on("error", reject);
      setTimeout(() => { ws.terminate(); reject(new Error("Timed out waiting for pending_approval")); }, 3000);
    });
    assert.equal(msg.type, "pending_approval");
    assert.ok(msg.connectionId, "Should include connectionId");

    // Drain the tools/list_changed notification emitted by pendConnection
    await readMcp();

    ws.terminate();
  });

  it("rejects connections with wrong token", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, ["wrong_token"]);
    const closed = await new Promise((resolve) => {
      ws.on("close", () => resolve(true));
      ws.on("error", () => resolve(true));
      setTimeout(() => { ws.terminate(); resolve(false); }, 2000);
    });
    assert.ok(closed, "Connection with wrong token should be closed");
  });

  it("daemon survives abrupt disconnect after rejection", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, ["wrong_token"]);
    ws.on("error", () => {});
    await new Promise((resolve) => {
      ws.on("open", resolve);
      ws.on("close", resolve);
      setTimeout(resolve, 500);
    });
    ws.terminate();

    await new Promise((r) => setTimeout(r, 100));

    sendMcp({ jsonrpc: "2.0", id: 999, method: "tools/list", params: {} });
    const res = await readMcp();
    assert.equal(res.id, 999);
    // Only the built-in tools, no browser tools
    assert.equal(res.result.tools.length, 2);
    assert.equal(res.result.tools[0].name, "bifrost_connection_info");
    assert.equal(res.result.tools[1].name, "bifrost_approve");
  });

  it("accepts connections with correct token", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, [token]);
    await new Promise((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    });

    const stayedOpen = await new Promise((resolve) => {
      let closed = false;
      ws.on("close", () => { closed = true; });
      setTimeout(() => {
        ws.terminate();
        resolve(!closed);
      }, 500);
    });
    assert.ok(stayedOpen, "Connection with correct token should stay open");
  });

  it("connection survives beyond HTTP keepAliveTimeout window", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, [token]);
    await new Promise((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    });

    const stayedOpen = await new Promise((resolve) => {
      let closed = false;
      ws.on("close", () => { closed = true; });
      setTimeout(() => {
        ws.terminate();
        resolve(!closed);
      }, 6000);
    });
    assert.ok(stayedOpen, "Connection should survive beyond 5s keepAliveTimeout");
  });
});

// ============================================================================
// Pending connection approval tests
// ============================================================================

describe("Pending connection approval", () => {
  let proc, port, token;
  let stdoutBuf = "";
  const stdoutLines = [];
  const stdoutWaiters = [];

  function sendMcp(msg) {
    proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  function readMcp(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      if (stdoutLines.length > 0) { resolve(stdoutLines.shift()); return; }
      const timer = setTimeout(() => {
        const idx = stdoutWaiters.indexOf(handler);
        if (idx !== -1) stdoutWaiters.splice(idx, 1);
        reject(new Error(`readMcp timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      function handler(val) { clearTimeout(timer); resolve(val); }
      stdoutWaiters.push(handler);
    });
  }

  before(async () => {
    port = nextPort();
    proc = spawn("node", [DAEMON_PATH, "--port", String(port)], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.stdout.on("data", (chunk) => {
      stdoutBuf += chunk;
      let idx;
      while ((idx = stdoutBuf.indexOf("\n")) !== -1) {
        const line = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (!line) continue;
        let parsed;
        try { parsed = JSON.parse(line); } catch { continue; }
        if (stdoutWaiters.length > 0) { stdoutWaiters.shift()(parsed); }
        else { stdoutLines.push(parsed); }
      }
    });

    token = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for daemon")), 5000);
      let buf = "";
      proc.stderr.on("data", (chunk) => {
        buf += chunk.toString();
        const match = buf.match(/Auth token \(use as header\): (\S+)/);
        if (match && buf.includes("Secure MCP bridge running")) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      });
    });
  });

  after(() => {
    proc.stdin.end();
    proc.kill("SIGKILL");
  });

  it("bifrost_connection_info shows pending connections", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const pendingMsg = await new Promise((resolve, reject) => {
      ws.on("message", (data) => resolve(JSON.parse(data.toString())));
      ws.on("error", reject);
      setTimeout(() => reject(new Error("Timeout")), 3000);
    });
    assert.equal(pendingMsg.type, "pending_approval");

    // Drain any tools/list_changed notification from pending
    await readMcp();

    sendMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "bifrost_connection_info", arguments: {} } });
    const res = await readMcp();
    const info = JSON.parse(res.result.content[0].text);
    assert.equal(info.status, "has_pending");
    assert.equal(info.pendingConnections.length, 1);
    assert.equal(info.pendingConnections[0].connectionId, pendingMsg.connectionId);

    ws.terminate();
  });

  it("approve promotes pending connection to active", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const wrapped = wrapWs(ws);
    await new Promise((resolve) => ws.on("open", resolve));

    const pendingMsg = await wrapped.readMessage();
    assert.equal(pendingMsg.type, "pending_approval");
    const connId = pendingMsg.connectionId;

    // Drain tools/list_changed from pending
    await readMcp();

    // Approve the connection
    sendMcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "bifrost_approve", arguments: { connectionId: connId } } });

    // Browser should receive approved
    const approvedMsg = await wrapped.readMessage();
    assert.equal(approvedMsg.type, "approved");

    // Browser should also receive welcome
    const welcomeMsg = await wrapped.readMessage();
    assert.equal(welcomeMsg.type, "welcome");

    // MCP should return success
    const mcpRes = await readMcp();
    const result = JSON.parse(mcpRes.result.content[0].text);
    assert.equal(result.approved, connId);

    // Now register tools and verify they appear
    wrapped.send({
      type: "register_tools",
      tools: [{ name: "test_tool", description: "Test", inputSchema: { type: "object" } }],
    });

    // Drain tools/list_changed from registration
    await readMcp();

    sendMcp({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
    const listRes = await readMcp();
    const names = listRes.result.tools.map((t) => t.name);
    assert.ok(names.some((n) => n.endsWith(":test_tool")), "Approved connection's tools should appear");

    ws.terminate();
    // Drain tools/list_changed from disconnect
    await readMcp();
  });

  it("bifrost_approve returns error for unknown connectionId", async () => {
    sendMcp({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "bifrost_approve", arguments: { connectionId: "conn_999" } } });
    const res = await readMcp();
    const result = JSON.parse(res.result.content[0].text);
    assert.ok(result.error, "Should return error for unknown connectionId");
  });

  it("valid token still bypasses approval", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, [token]);
    const wrapped = wrapWs(ws);
    await new Promise((resolve) => ws.on("open", resolve));

    const msg = await wrapped.readMessage();
    assert.equal(msg.type, "welcome", "Token-authenticated connection should get welcome immediately");

    ws.terminate();
  });
});
