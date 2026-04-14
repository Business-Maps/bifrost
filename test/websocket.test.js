import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import { MiniWebSocketServer } from "../lib/websocket.js";
import { createConnection } from "net";
import WebSocket from "ws";

describe("MiniWebSocketServer", () => {
  let server;
  let TEST_PORT;
  const clients = new Set();

  function connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
      clients.add(ws);
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
    });
  }

  before(async () => {
    server = new MiniWebSocketServer({ port: 0 }, () => {});
    await new Promise((resolve) => {
      server.server.once("listening", resolve);
    });
    TEST_PORT = server.server.address().port;
  });

  after(() => {
    for (const ws of clients) ws.terminate();
    clients.clear();
    server.close();
  });

  it("accepts WebSocket connections and emits messages", async () => {
    const messageReceived = new Promise((resolve) => {
      server.once("connection", (ws) => {
        ws.on("message", (data) => resolve(data));
      });
    });

    const ws = await connect();
    ws.send(JSON.stringify({ type: "test" }));

    const msg = await messageReceived;
    assert.equal(msg, '{"type":"test"}');
  });

  it("can send messages to the client", async () => {
    server.once("connection", (ws) => {
      ws.send("hello from server");
    });

    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
    clients.add(ws);

    const msg = await new Promise((resolve, reject) => {
      ws.on("message", (data) => resolve(data.toString()));
      ws.on("error", reject);
    });

    assert.equal(msg, "hello from server");
  });

  it("rejects HTTP requests without WebSocket upgrade", async () => {
    const response = await new Promise((resolve, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port: TEST_PORT }, () => {
        socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
        socket.once("data", (data) => {
          socket.destroy();
          resolve(data.toString());
        });
      });
      socket.on("error", reject);
    });

    assert.ok(response.includes("426"));
  });
});
