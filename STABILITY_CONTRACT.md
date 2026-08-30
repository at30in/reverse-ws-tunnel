# Stability Contract

**Project**: `@remotelinker/reverse-ws-tunnel`
**Version**: 1.1.0
**Effective**: 2026-08-26
**Scope**: All production modules under `server/`, `client/`, `utils/`

This document defines the behavioral, lifecycle, protocol, resource, and minimum-performance invariants of the library. Any AI agent or human contributor must read this document before modifying code. Violating an invariant requires an explicit contract amendment and regression test.

---

## 1. Purpose

This document establishes a stable, versioned contract for `@remotelinker/reverse-ws-tunnel`. It serves three goals:

1. **Prevent regressions**: Every invariant here has a concrete behavioral guarantee. Breaking it is a breaking change.
2. **Guide AI development**: An autonomous agent can read this file and understand which behaviors are non-negotiable.
3. **Document reality**: The contract distinguishes between what is currently implemented, what is desired, and what is a known issue.

The contract does not replace tests. It complements them by declaring intent that tests may not yet cover.

---

## 2. Scope

This contract covers the following subsystems:

| Subsystem | Modules |
|-----------|---------|
| WebSocket server | `server/websocketServer.js`, `server/index.js` |
| WebSocket client | `client/tunnelClient.js`, `client/index.js` |
| TCP connections | `server/tcpServer.js` |
| Tunnel lifecycle | `server/state.js`, `server/messageHandler.js` |
| Reconnect | `client/tunnelClient.js` |
| Heartbeat | `client/tunnelClient.js`, `server/websocketServer.js` |
| Binary protocol | `utils/frameParser.js`, `client/utils.js` |
| Buffering / backpressure | `utils/backpressureSender.js`, `utils/streamWriteQueue.js`, `utils/tunnelLimits.js` |
| Cleanup | All modules (cleanup is distributed) |
| Resource ownership | All modules |
| Error handling | All modules |
| HTTP/TCP forwarding | `server/tcpServer.js`, `client/tunnelClient.js`, `client/proxyServer.js` |

---

## 3. Core Invariants

### Resource Safety

**RWT-RES-001**: Every `StreamWriteQueue` created during a tunnel's lifetime must be destroyed before or during tunnel cleanup. After cleanup, `queue.isDestroyed()` must return `true`.

**RWT-RES-002**: Every `BackpressureSender` created during a tunnel's lifetime must be destroyed before or during tunnel cleanup. After cleanup, the sender must not attempt to send on the WebSocket.

### WebSocket

**RWT-WS-001**: When `stopWebSocketServer(port)` resolves, no WebSocket connection associated with that port is in OPEN state. All heartbeat timers for those connections are cleared.

**RWT-WS-002**: A duplicate tunnel ID connecting while an existing connection is OPEN must be rejected with close code 1008. The existing connection must not be disrupted.

### TCP

**RWT-TCP-001**: When a TCP socket is destroyed, `cleanupConn` must run exactly once. The second invocation (from the `close` event after `error`) must be a no-op.

**RWT-TCP-002**: When a TCP socket sends data via `ensureConn` and `conn` already exists, the existing connection must be reused. A new connection must not be created for the same UUID while one is active.

### Protocol

**RWT-PROTO-001**: The wire format is `[4B BE length][36B tunnelId][36B uuid][1B type][payload]`. Overhead is 77 bytes per frame. The length field excludes itself. tunnelId and uuid are exactly 36 characters. type is one of the `MESSAGE_TYPE_*` constants defined in `server/constants.js`.

**RWT-PROTO-002**: A frame with `declaredLength > maxFrameSizeBytes` must be rejected before allocation with `FrameSizeError`. No data beyond the frame header must be forwarded to the application.

### Backpressure

**RWT-BP-001**: When `StreamWriteQueue.queuedBytes` exceeds `maxBufferPerStreamBytes`, the queue must self-destroy and the associated TCP connection must be closed. This is a hard limit.

**RWT-BP-002**: When `BackpressureSender` outstanding bytes exceed `highWatermark`, the sender must pause the associated TCP socket (server-side) or stop reading (client-side). When outstanding bytes drop below `lowWatermark`, reading must resume. This is a soft limit with hysteresis.

### Client

**RWT-CLIENT-001**: After `client.close()` is called, no reconnect attempt must occur regardless of the `autoReconnect` setting.

### Server

**RWT-SERVER-001**: `stopWebSocketServer()` must be idempotent. Calling it when no server is running must resolve without error.

### Lifecycle

**RWT-LIFE-001**: A TCP connection (`conn`) entry must exist in `tunnel.tcpConnections[uuid]` if and only if the TCP socket is alive. After the socket is destroyed or the connection is cleaned up, `tunnel.tcpConnections[uuid]` must be `undefined`.

**RWT-LIFE-002**: A tunnel entry in `state[port].websocketTunnels[tunnelId]` must exist if and only if the WebSocket connection for that tunnel is OPEN or CONNECTING. After cleanup, the entry must be deleted.

### Error Handling

**RWT-ERR-001**: No error path in any module must throw an unhandled exception that crashes the Node.js process. Errors must be logged and must result in connection cleanup or reconnect, never process termination.

---

## 4. Resource Lifecycle

### WebSocket Server

| Phase | Detail |
|-------|--------|
| Created by | `startWebSocketServer(port)` |
| Owner | Caller of `startWebSocketServer` |
| Active when | Server is listening and accepting connections |
| Must be closed by | `await stopWebSocketServer(port)` |
| After cleanup | Server not listening; no sockets in OPEN state; state entries deleted; heartbeat timers cleared |

### WebSocket Client

| Phase | Detail |
|-------|--------|
| Created by | `connectWebSocket()` (client/tunnelClient.js) |
| Owner | The event emitter returned by `connectWebSocket` |
| Active when | `ws.readyState === OPEN` |
| Must be closed by | `eventEmitter.close()` or WS `close`/`error` event |
| After cleanup | `clients` map entry deleted; all TCP connections destroyed; heartbeat timers cleared; reconnect suppressed if `client.close()` was called |

### TCP Server

| Phase | Detail |
|-------|--------|
| Created by | `ensureTCPServer(port)` via `startTCPServer` |
| Owner | `state.tcpServers[portKey]` |
| Active when | Server is listening and accepting connections |
| Must be closed by | `forceClosePort(port)` or `stopWebSocketServer()` |
| After cleanup | No listening socket; `state.tcpServers[portKey]` deleted |

### TCP Connection

| Phase | Detail |
|-------|--------|
| Created by | `ensureConn(tunnel, uuid, socket)` (server-side) or `createTcpClient(uuid, data)` (client-side) |
| Owner | The tunnel object (server-side) or `clients[uuid]` (client-side) |
| Active when | Socket is writable and not destroyed |
| Must be closed by | `cleanupConn(reason)` (server) or `cleanupLocal(reason)` (client) |
| After cleanup | `tunnel.tcpConnections[uuid]` deleted (server) or `clients[uuid]` deleted (client); queue destroyed; sender destroyed; metrics unregistered |

### Heartbeat Timers

| Phase | Detail |
|-------|--------|
| Created by | `setInterval` in WS server ping handler (server) or client ping/health monitor |
| Owner | The WS connection that spawned them |
| Active when | Connection is OPEN |
| Must be cleared by | WS `close` event handler (`clearInterval`) |
| After cleanup | No pending `setTimeout` or `setInterval` referencing the closed connection |

### Body Coalescer Timers

| Phase | Detail |
|-------|--------|
| Created by | `kOnBody` callback in `server/tcpServer.js` when body data arrives |
| Owner | The TCP connection closure |
| Active when | Timer is armed (5ms window) |
| Must be cleared by | `cleanupConn` (currently NOT cleared — see Known Issues) |
| After cleanup | **[KNOWN ISSUE]** Timer may fire after cleanup, creating a zombie connection |

### StreamWriteQueue

| Phase | Detail |
|-------|--------|
| Created by | `createStreamWriteQueue(socket, options)` |
| Owner | The module that created it (tcpServer or tunnelClient) |
| Active when | `isDestroyed() === false` and `depth > 0` |
| Must be destroyed by | `queue.destroy()` or automatic on socket `close`/`error` or overflow |
| After cleanup | `isDestroyed() === true`; `queuedBytes === 0`; drain listener removed; socket listener removed |

### BackpressureSender

| Phase | Detail |
|-------|--------|
| Created by | `createBackpressureSender(ws, options)` |
| Owner | The module that created it (tcpServer or tunnelClient) |
| Active when | `isDestroyed() === false` and `ws.readyState === OPEN` |
| Must be destroyed by | `sender.destroy()` |
| After cleanup | **[KNOWN ISSUE]** `destroyed` is not guarded; double-destroy is harmless but not idempotent |

### Tunnel Registry Entries

| Phase | Detail |
|-------|--------|
| Created by | `handleParsedMessage` on CONFIG message |
| Owner | The WS connection that sent the CONFIG |
| Active when | WS is OPEN and CONFIG has been processed |
| Must be deleted by | `cleanup()` in `websocketServer.js` |
| After cleanup | `state[port].websocketTunnels[tunnelId]` is `undefined`; all `tcpConnections` entries destroyed |

---

## 5. Shutdown Contract

When the caller evaluates:

```js
await stopWebSocketServer(port)
```

the following postconditions must hold:

| Postcondition | Currently guaranteed |
|---------------|---------------------|
| Server no longer listening | Yes |
| WebSocket connections closed | Yes |
| TCP servers closed | Yes |
| TCP connections destroyed | Yes |
| Heartbeat timers removed | Yes |
| Body coalescer timers removed | **No** (known issue) |
| State registry cleaned | Yes |
| No new data sent through server-owned resources | Yes |
| Calling stop again produces no error | Yes |
| All async cleanup complete before resolution | **No** — `handleParsedMessage` for CONFIG is fire-and-forget; async TCP server creation may not complete before the Promise resolves |

---

## 6. Reconnect Contract

### Expected Behavior

When the WebSocket client connection is lost (server crash, network partition, server restart):

1. The client detects the close event.
2. The client destroys all TCP connections and their queues/senders.
3. The client attempts reconnection with exponential backoff.
4. On successful reconnection, the client sends a fresh CONFIG message.
5. New TCP connections are accepted and forwarded to the target.

### Expected Behavior on Rapid Reconnect

If the connection drops and is re-established within seconds:

1. The old state is fully cleaned up before the new connection is established.
2. No duplicate tunnel entries exist in the server state.
3. No stale TCP servers remain from the previous connection.

### Expected Behavior on Repeated Failure

If the server remains unavailable:

1. Reconnection attempts continue with exponential backoff.
2. The maximum backoff is capped (currently the length of `RECONNECT_BACKOFF` array).
3. Memory and resource usage remain bounded.
4. The capability to reconnect is never permanently lost.

### What Must NOT Happen

| Prohibition | Status |
|-------------|--------|
| Duplicate connections not authorized | Enforced by server duplicate detection (RWT-WS-002) |
| Duplicate heartbeat timers | **[KNOWN ISSUE]** Pong listeners accumulate if timeout fires before pong |
| Stale state from previous connection | Ensured by `destroyAllClients` + state cleanup |
| Stale TCP servers | Ensured by `forceClosePort` in `ensureTCPServer` retry |
| EADDRINUSE caused by library lifecycle | Partially — `forceClosePort` has a leak (see Known Issues) |
| Permanent loss of reconnect capability | Not possible — `isClosed` flag controls reconnect; never set permanently except by explicit `client.close()` |

---

## 7. Heartbeat Contract

### Server-Side Heartbeat (websocketServer.js)

- The server sends a WebSocket ping at `PING_INTERVAL` (30s).
- If no pong is received before the next ping interval, the connection is terminated.
- The heartbeat interval is cleared on WS `close` or `error`.

### Client-Side Heartbeat (tunnelClient.js)

- The client sends a WebSocket ping at `PING_INTERVAL` (30s).
- A pong timeout of `PONG_WAIT` triggers `ws.terminate()` if no pong arrives.
- An application-level ping (`APP_PING`) is sent with an incrementing sequence number.
- A health monitor checks `lastPongTs` every 5s; if no pong in 45s, the connection is terminated.

### Timer Cleanup

| Timer | Cleared by |
|-------|-----------|
| Server ping interval | `clearInterval(interval)` in `cleanup()` |
| Client ping interval | `clearInterval(pingInterval)` in WS `close` handler |
| Client app ping interval | `clearInterval(appPingInterval)` in WS `close` handler |
| Client health monitor | `clearInterval(healthMonitor)` in WS `close` handler |
| Client pong timeout | `clearTimeout(pongTimeout)` in pong listener or WS `close` handler |

### Behavior Under Traffic

Heartbeat pings continue to be sent even when data is flowing. Data and heartbeat are independent channels on the same WebSocket.

### Behavior When Peer Does Not Respond

1. Pong timeout fires → `ws.terminate()`.
2. Health monitor fires → `ws.terminate()`.
3. Both result in the WS `close` event → full cleanup + reconnect.

---

## 8. Protocol Contract

### Wire Format

```
Byte offset  Length  Field
0            4       length (big-endian uint32, excludes itself)
4            36      tunnelId (ASCII, fixed 36 chars)
40           36      uuid (ASCII, fixed 36 chars)
76           1       type (MESSAGE_TYPE constant)
77           N       payload (N = length - 73)
```

Overhead per frame: 77 bytes.

### Fields

| Field | Encoding | Constraints |
|-------|----------|------------|
| `length` | Big-endian uint32 | Must equal `73 + payload.length` (excludes the 4 length bytes themselves) |
| `tunnelId` | ASCII string, 36 chars | Identifies the tunnel |
| `uuid` | ASCII string, 36 chars | Identifies the TCP connection stream |
| `type` | Single byte | One of: `MESSAGE_TYPE_DATA` (0x00), `MESSAGE_TYPE_CONFIG` (0x01), `MESSAGE_TYPE_APP_PING` (0x02), `MESSAGE_TYPE_APP_PONG` (0x03) |
| `payload` | Binary | Type-specific content |

### Max Frame Size

- Default: 1MB (`RWT_MAX_FRAME_SIZE_BYTES`).
- Configurable via `RWT_MAX_FRAME_SIZE_BYTES` env var.
- A frame exceeding this size is rejected with `FrameSizeError` **before** the payload is allocated.

### Frame Malformed

- If `declaredLength` is inconsistent with actual data, the parser accumulates more data.
- If `declaredLength < 73` (minimum header), the parser raises `FrameSizeError`.
- The parser is incremental: partial frames are stashed until complete.

### Frame Oversize

- `FrameSizeError` is thrown with `declaredLength` and `maxFrameSizeBytes` properties.
- No application callback is invoked for the rejected frame.
- The parser continues processing subsequent frames in the buffer.

---

## 9. Backpressure Contract

### Limits

| Limit | Default | Env Var | Type |
|-------|---------|---------|------|
| `highWatermark` | 8MB | `RWT_HIGH_WATERMARK` | Soft — pause reading |
| `lowWatermark` | 2MB | `RWT_LOW_WATERMARK` | Soft — resume reading |
| `maxFrameSizeBytes` | 1MB | `RWT_MAX_FRAME_SIZE_BYTES` | Hard — reject frame |
| `maxBufferPerStreamBytes` | 64MB | `RWT_MAX_BUFFER_PER_STREAM_BYTES` | Hard — destroy queue + close TCP |
| `maxBufferPerTunnelBytes` | 256MB | `RWT_MAX_BUFFER_PER_TUNNEL_BYTES` | Hard — destroy queue + close TCP |
| `maxBufferPerProcessBytes` | 512MB | `RWT_MAX_BUFFER_PER_PROCESS_BYTES` | Soft — log warning only |
| `tcpIdleTimeout` | 60s | `RWT_TCP_IDLE_TIMEOUT_MS` | Hard — close idle TCP connections |

### Hysteresis

```
outstanding >= highWatermark  → pause TCP socket (stop reading)
outstanding <= lowWatermark   → resume TCP socket (start reading)
```

The gap between HIGH and LOW prevents oscillation (thrashing).

### Behavior When a Queue Reaches Its Limit

1. `StreamWriteQueue.overflow()` fires.
2. The queue is destroyed.
3. The associated TCP socket is destroyed.
4. A `CLOSE` frame is sent to the peer (client-side) or the connection is torn down (server-side).
5. The tunnel itself survives.

### Behavior When the Consumer Is Slow

1. Data accumulates in the `StreamWriteQueue`.
2. `queuedBytes` increases.
3. When `queuedBytes >= maxBufferPerStreamBytes`, overflow triggers.
4. If the consumer catches up before the limit, `drain` fires and processing resumes.

### Hard vs. Soft Limits

| Limit | Consequence of Exceeding |
|-------|--------------------------|
| `maxBufferPerStreamBytes` | Stream destroyed (hard) |
| `maxBufferPerTunnelBytes` | Stream destroyed (hard) |
| `maxBufferPerProcessBytes` | Warning logged (soft) |
| `highWatermark` | TCP reading paused (soft) |
| `lowWatermark` | TCP reading resumed (soft) |

---

## 10. HTTP/TCP Forwarding Contract

### Supported Methods

All HTTP methods are supported. The TCP server uses `http-parser-js` to parse the incoming request. The method is not filtered.

### Request Handling

| Aspect | Behavior |
|--------|----------|
| Headers | Forwarded to the target as-is (except for chunked TE headers) |
| Body | Parsed by `http-parser-js`; forwarded via `sendBody` or `sendData` |
| Chunked Transfer-Encoding | Handled: `http-parser-js` de-chunks; the server re-frames with `chunkedMode` and sends raw body chunks via `sendBody` |
| Keep-Alive | Supported; multiple requests per TCP connection |
| Connection: close | Supported; triggers TCP socket close after response |

### Response Handling

| Aspect | Behavior |
|--------|----------|
| Status code | Forwarded to the client as-is |
| Headers | Forwarded to the client as-is |
| Body | Streamed back via the WebSocket → TCP socket |
| Chunked response | Handled by the client's HTTP parser |
| Error from target | HTTP error status forwarded; TCP connection may be closed depending on `Connection` header |

### Target Unreachable

If the target TCP server is not running or refuses the connection:
- `net.createConnection` emits `error`.
- The error is logged.
- The TCP connection is cleaned up.

---

## 11. Error Handling Contract

### Errors That Must Close a Connection

| Error | Scope |
|-------|-------|
| `FrameSizeError` | The specific frame is rejected; the connection continues |
| TCP socket `error` | The TCP connection is destroyed |
| TCP socket `end` (FIN) | The TCP connection is half-closed; `CLOSE` frame sent |
| WS `error` | The WS connection is terminated; all TCP connections torn down |
| WS `close` | Full cleanup of tunnel and all associated TCP connections |

### Errors That Must Close Only One Stream

| Error | Scope |
|-------|-------|
| `StreamWriteQueue` overflow | One TCP stream is destroyed; tunnel survives |
| `BackpressureSender` send error | One stream's sender is destroyed; the TCP socket is cleaned up |

### Errors That Must Trigger Reconnect

| Error | Scope |
|-------|-------|
| WS `close` event | Client reconnects with exponential backoff |
| WS `error` event | Client reconnects with exponential backoff |
| Pong timeout | Client terminates WS → triggers close → reconnect |
| Health monitor timeout | Client terminates WS → triggers close → reconnect |

### Errors That Must NOT Crash the Process

All errors in `server/*`, `client/*`, and `utils/*` must be caught and logged. No `throw` must propagate to an unhandled `uncaughtException` or `unhandledRejection` handler.

---

## 12. Memory and Resource Safety

### Bounded Buffers

| Resource | Bound | Enforcement |
|----------|-------|-------------|
| `StreamWriteQueue` per stream | `maxBufferPerStreamBytes` (64MB) | Hard — destroy |
| `StreamWriteQueue` per tunnel | `maxBufferPerTunnelBytes` (256MB) | Hard — destroy |
| `StreamWriteQueue` per process | `maxBufferPerProcessBytes` (512MB) | Soft — warn |
| `BackpressureSender` outstanding | `highWatermark` (8MB) | Soft — pause |
| `FrameParser` stash | `maxFrameSizeBytes` (1MB) | Hard — reject |

### Timers

| Timer | Lifetime | Cleanup |
|-------|----------|---------|
| WS server ping interval | Per connection | `clearInterval` in `cleanup()` |
| Client ping interval | Per connection | `clearInterval` in WS `close` handler |
| Client app ping interval | Per connection | `clearInterval` in WS `close` handler |
| Client health monitor | Per connection | `clearInterval` in WS `close` handler |
| Client pong timeout | Per ping cycle | `clearTimeout` in pong listener |
| Body coalescer timer | Per body chunk | **[KNOWN ISSUE]** Not cleaned by `cleanupConn` |
| Metrics summary timer | Global | `clearInterval` in `dispose()` |

### Sockets

| Socket | Bound by |
|--------|----------|
| TCP entry socket (server) | `maxBufferPerStreamBytes` via queue overflow |
| TCP target socket (client) | `net.createConnection` timeout + error handling |
| WebSocket connection | WS library internal limits |

### WebSocket Connections

| Bound | Mechanism |
|-------|-----------|
| Per-tunnel | One WS per tunnel ID; duplicates rejected |
| Per-port | Configurable via `PORTS` env var |
| Max buffered | `ws.maxBufferedAmount` (currently no-op guard) |

### Listeners

| Concern | Status |
|---------|--------|
| WS `pong` listener accumulation | **[KNOWN ISSUE]** Orphan listeners on timeout |
| `fs.watchFile` for logger | **[KNOWN ISSUE]** No `unwatchFile` on re-init |
| `streamWriteQueue` drain listener | Properly removed on destroy |
| `streamWriteQueue` close/error listeners | Properly removed on destroy |

### Registry Entries

| Registry | Bound by |
|----------|----------|
| `state[port].websocketTunnels[tunnelId]` | One entry per tunnel; deleted on cleanup |
| `state[port].tcpConnections[uuid]` | One entry per TCP stream; deleted on cleanup |
| `state.tcpServers[portKey]` | One entry per port; deleted on `stopWebSocketServer` |
| `clients[uuid]` (client-side) | One entry per TCP stream; deleted on cleanup |

---

## 13. Concurrency and Race Safety

### Identified Races

#### R1: BackpressureSender reconcile vs. pending callback

**Description**: `reconcile()` can reset `outstanding = 0` while a `ws.send()` completion callback is pending. When the callback fires, `outstanding` goes negative, is clamped to 0, and the pause/resume hysteresis is temporarily incorrect.

**Classification**: **Acceptable trade-off**. The reconcile safety net is documented in `backpressureSender.js:107-113`. The brief flow-control thrashing under heavy load is tolerated.

**Regression test required**: No.

#### R2: Pong listener accumulation

**Description**: `ws.once('pong', ...)` inside `setInterval` accumulates orphan listeners if the pong timeout fires before the pong arrives.

**Classification**: **Should be eliminated**. The listener is eventually garbage-collected on reconnect, but the accumulation is a code smell.

**Regression test required**: Yes — when fixed.

#### R3: CONFIG → DATA ordering

**Description**: `handleParsedMessage()` is async but not awaited. A rapid CONFIG + DATA sequence may process DATA before the TCP server is ready.

**Classification**: **Eliminated**. The `ws.on('message', ...)` callback is now `async`; each `handleParsedMessage()` call is `await`ed, serializing CONFIG and DATA dispatch. Errors are caught by an outer `try/catch`.

**Regression test required**: Yes — `configDataOrdering.test.js`.

#### R4: Concurrent cleanup

**Description**: If `cleanup()` in `websocketServer.js` throws before `ws.removeAllListeners()`, the other event handler fires and calls `cleanup()` again, potentially double-destroying TCP sockets.

**Classification**: **Eliminated**. Cleanup body is wrapped in `try/finally`; `clearInterval` and `ws.terminate()` always run. `ws.removeAllListeners()` is intentionally not called to preserve the ws library's internal close listener for `WebSocket.Server.clients` tracking.

**Regression test required**: Yes — `harnessClose.integration.test.js` "cleanup called twice (error then close) is idempotent".

#### R5: Reconnect concurrent with transfer

**Description**: If a reconnect happens while data is in flight, the old TCP connections are destroyed before the data completes.

**Classification**: **Acceptable behavior**. The data is lost with the connection. The new connection starts fresh.

**Regression test required**: No.

#### R6: Shutdown during transfer

**Description**: `stopWebSocketServer()` is async but `integrationHarness.js` does not await it. Ports may remain bound.

**Classification**: **Eliminated** in the harness. The production code is correct; the test harness has been fixed.

**Regression test required**: Yes — `harnessClose.integration.test.js` "WS server port is no longer listening after close() resolves" and "consecutive harnesses do not leak ports".

---

## 14. Testing Requirements

### Test Pyramid

```
                    /\
                   /  \         Stress/GC (2-3 tests, --forceExit)
                  /    \        gated behind --expose-gc
                 /------\
                /        \      Integration (8-10 suites)
               /  Real     \   full tunnel TCP↔WS↔TCP
              /  tunnel     \  volumes, resilience, backpressure
             /--------------\  + wire compat, round-trip
            /                \
           /  Component test  \  (4-5 suites)
          /  Mock a bordo      \ msgHandler, tcpServer, tunnelClient
         /  WS/TCP reali       \ duplicate ID, body coalescer, chunked TE
        /----------------------\
       /                        \
      /      Unit test (8+ suites)\
     /  FrameParser, SWQ, Sender  \
    /  Limits, Metrics, Logger     \
   /--------------------------------\
```

### When to Add or Update Tests

| Change Type | Test Requirement |
|-------------|-----------------|
| New module | Unit tests for all exported functions |
| Bug fix | Regression test reproducing the bug |
| New behavior | Unit + integration test |
| Changed invariant | Update contract + regression test |
| Removed feature | Remove corresponding tests; update contract |
| Performance change | Benchmark or stress test |
| Refactor (no behavior change) | All existing tests must still pass |

### Flaky Test Policy

A test that fails intermittently must be investigated before being marked as flaky. The root cause must be documented. Timing-dependent tests must use controllable delays, not fixed sleeps.

---

## 15. AI Development Rules

These rules are mandatory for any AI agent modifying this codebase.

1. **Never modify a test to make it pass.** If a test fails, fix the code. If the test is wrong, document why and fix the test with an explanation.

2. **Never remove an assertion without explaining why the contract changed.** Every removed assertion must be accompanied by a change to this document explaining the new expected behavior.

3. **Never increase timeouts to hide race conditions.** Increasing a timeout masks the underlying issue. Identify and fix the race.

4. **Never add retry logic to hide flaky behavior without first identifying the cause.** Retry is not a substitute for correctness.

5. **Every bug fix must have a regression test when technically possible.** A fix without a test is a temporary workaround.

6. **Before modifying code, identify which RWT-* invariants are involved.** Read the relevant sections of this document.

7. **After a modification, run all pertinent tests.** "Pertinent" means all tests that exercise the changed module and its callers.

8. **A change that violates an invariant requires an explicit contract amendment.** Update this document, update the regression tests, and bump the version.

9. **Never use `--forceExit` to hide resource leaks in tests.** If `--forceExit` is temporarily necessary, document the reason and create an issue to remove it.

10. **Never declare a modification "stable" based solely on local tests passing.** Stability is defined in Section 17.

---

## 16. Current Known Issues

These issues were identified during the repository audit on 2026-08-26. They are known deficiencies in the current implementation. Each must be tracked until resolved.

---

**RWT-KNOWN-001**: Body coalescer zombie timer

- **Severity**: Medium
- **Component**: `server/tcpServer.js`
- **Description**: `cleanupConn` does not cancel the `bodyCoalescer` timer. After cleanup, the timer fires (5ms window), calls `flush()` → `sendBody()` → `sendData()` → `ensureConn()`, which recreates a connection object for a dead TCP stream. Data for the dead stream is forwarded to the agent.
- **Expected fix direction**: Null out `bodyCoalescer` in `cleanupConn` and check for null in `flush`.
- **Regression test required**: Yes.
- **Status**: **RESOLVED** (2026-08-26). `makeBodyCoalescer()` now tracks an `active` flag. `flush()` and `push()` are no-ops when `active` is false. A `cancel()` method sets `active = false` and clears the timer. `cleanupConn()` calls `bodyCoalescer.cancel()` and nulls the reference before destroying queue/sender. Regression test: `tcpServerBodyCoalescer.test.js` "should cancel timer on cleanup and not send body data" and "should not recreate TCP connection for same UUID after cleanup".

---

**RWT-KNOWN-002**: forceClosePort leaked takeover server

- **Severity**: Low
- **Component**: `server/tcpServer.js`
- **Description**: When `takeover.listen(port)` fails with EADDRINUSE, `takeover.close()` is never called. The native TCP handle remains allocated.
- **Expected fix direction**: Add `takeover.close()` in the EADDRINUSE error handler.
- **Regression test required**: Yes.
- **Status**: **RESOLVED** (2026-08-26). `forceClosePort()` now calls `takeover.close()` in the EADDRINUSE error handler before resolving. The `setTimeout` delay was removed; `takeover.close()` callback resolves the promise directly. Regression test: `tcpServerCleanup.test.js` "takeover.close() is called when listen() gets EADDRINUSE".

---

**RWT-KNOWN-003**: Logger watcher cleanup

- **Severity**: Low
- **Component**: `utils/logger.js`
- **Description**: `watchLogConfig()` calls `fs.watchFile()` without a corresponding `fs.unwatchFile()`. If `initLogger()` is called multiple times, multiple watchers accumulate on the same file.
- **Expected fix direction**: Track the watcher and call `unwatchFile` before creating a new one.
- **Regression test required**: Yes.
- **Status**: **RESOLVED** (2026-08-26). Added `watchedFilePath` module-level variable to track the currently watched file. `watchLogConfig()` now calls `fs.unwatchFile(watchedFilePath)` before creating a new watcher. Added `dispose()` function that calls `fs.unwatchFile()` and resets state. Exported `dispose` from the module. Regression tests: `logger.test.js` "should not accumulate watchers when initLogger is called multiple times" and "should call unwatchFile on previous path before watching new path".

---

**RWT-KNOWN-004**: Non-idempotent sender.destroy

- **Severity**: Low
- **Component**: `utils/backpressureSender.js`
- **Description**: `destroy()` has no `if (destroyed) return;` guard at the top. Double-destroy is harmless (clears already-zero outstanding, calls `clearBuffered` on a deleted key) but is not idempotent.
- **Expected fix direction**: Add an early-return guard.
- **Regression test required**: Yes.
- **Status**: **RESOLVED** (2026-08-26). `destroy()` now has `if (destroyed) return;` guard at the top. The `ws.send` completion callback also checks `if (destroyed) return;` to prevent a pending callback from resurrecting the sender after destroy. Nine regression tests added to `backpressureSender.test.js`: double/triple destroy, send after destroy, pending callback after destroy, reconcile after destroy, destroy during paused state, destroy on never-used sender.

---

**RWT-KNOWN-005**: cleanup without try/finally

- **Severity**: Medium
- **Component**: `server/websocketServer.js`
- **Description**: The `cleanup()` function does not wrap its body in `try/finally`. If `METRICS.unregisterTunnel()` throws, cleanup aborts before `ws.removeAllListeners()`, allowing the other event handler to call cleanup again, double-destroying TCP sockets.
- **Expected fix direction**: Wrap cleanup body in `try/finally`; ensure `removeAllListeners()` always runs.
- **Regression test required**: Yes.
- **Status**: **RESOLVED** (2026-08-26). `cleanup()` body is wrapped in `try/finally`. `clearInterval(interval)` and `ws.terminate()` always execute. `ws.removeAllListeners()` was intentionally removed (not just guarded) because the ws library's internal close listener is required for `WebSocket.Server.close()` to de-register clients from its internal Set. Regression test: `harnessClose.integration.test.js` "cleanup called twice (error then close) is idempotent".

---

**RWT-KNOWN-006**: ws.send without readyState check

- **Severity**: Medium
- **Component**: `server/messageHandler.js`
- **Description**: `ws.send(pongMessage)` in the APP_PING handler has no `readyState` check. If the WS is CLOSING or CLOSED, the call throws an unhandled exception.
- **Expected fix direction**: Guard with `if (ws.readyState !== WebSocket.OPEN) return;`.
- **Regression test required**: Yes.
- **Status**: **RESOLVED** (2026-08-26). APP_PING handler now checks `ws.readyState !== WebSocket.OPEN` before calling `ws.send()`. If the socket is CLOSING or CLOSED, the pong is dropped and a debug log is emitted. The guard is placed after building the pong message (so it is always valid) but before sending. Regression test: `messageHandler.test.js` "does not call ws.send when readyState is CLOSING" / "CLOSED" / "CONNECTING".

---

**RWT-KNOWN-007**: Async stopWebSocketServer not awaited in harness

- **Severity**: Medium
- **Component**: `__tests__/helpers/integrationHarness.js`
- **Description**: `stopWebSocketServer()` is async but called without `await` in `close()`. Cleanup runs in the background; ports may remain bound between tests.
- **Expected fix direction**: Add `await` before `stopWebSocketServer()`.
- **Regression test required**: Yes (the harness fix itself).
- **Status**: **RESOLVED** (2026-08-26). `close()` now passes `wsPort` to `stopWebSocketServer()` and awaits it. Regression tests: `harnessClose.integration.test.js` "WS server port is no longer listening after close() resolves" and "consecutive harnesses do not leak ports".

---

**RWT-KNOWN-008**: proxyServer.close without double-close handling

- **Severity**: Low
- **Component**: `client/proxyServer.js`
- **Description**: `server.close()` is called without a callback. If called twice, `ERR_SERVER_NOT_RUNNING` is thrown as an unhandled exception.
- **Expected fix direction**: Guard with a `closed` flag or wrap in try/catch.
- **Regression test required**: Yes.
- **Status**: **RESOLVED** (2026-08-26). `close()` now checks `server.listening` before calling `server.close()`. If the server is not listening (already closed or never started), `close()` returns immediately without calling `server.close()`. Three regression tests added to `proxyServer.test.js`: double-close with strict mock, close after close, close when never listening.

---

**RWT-KNOWN-009**: Pong listener accumulation

- **Severity**: Low
- **Component**: `client/tunnelClient.js`
- **Description**: `ws.once('pong', ...)` inside `setInterval` accumulates orphan listeners if the pong timeout fires before the pong arrives. Listeners are garbage-collected on reconnect.
- **Expected fix direction**: Store the listener reference and remove it in the timeout path.
- **Regression test required**: Yes.
- **Status**: **RESOLVED** (2026-08-26). `heartBeat()` now tracks `pongHandler` and `pongTimeout` references. `cleanupPong()` removes the pong listener and clears the timeout. Called before each new ping cycle, on pong arrival, on timeout, and on WS close. Maximum one pong listener active per cycle. Nine regression tests added to `tunnelClientHeartbeat.test.js`.

---

**RWT-KNOWN-010**: CONFIG/DATA ordering

- **Severity**: Low
- **Component**: `server/websocketServer.js`, `server/messageHandler.js`
- **Description**: `handleParsedMessage()` is async but not awaited. A rapid CONFIG + DATA sequence may process DATA before the TCP server is ready. DATA is dropped for the not-yet-ready stream.
- **Expected fix direction**: Consider awaiting `handleParsedMessage` or documenting this as intentional.
- **Regression test required**: Yes.
- **Status**: **RESOLVED** (2026-08-26). The `ws.on('message', ...)` callback in `websocketServer.js` is now `async`. Each `handleParsedMessage()` call is `await`ed inside the frame-processing loop, serializing CONFIG and DATA dispatch. An `outer try/catch` around the `await` ensures that errors from `handleParsedMessage` (including DATA handler rejections) are caught and logged, preventing unhandled rejections and keeping the process alive. Regression tests: `configDataOrdering.test.js` (7 tests).

---

**RWT-KNOWN-011**: Vacuous assertions in tests

- **Severity**: Low
- **Component**: `__tests__/integration/volumes.integration.test.js`, `__tests__/integration/backpressure.integration.test.js`, `__tests__/tunnelMetrics.test.js`
- **Description**: Multiple assertions use `toBeGreaterThanOrEqual(0)` for count/metric values, which is always true. These assertions verify nothing.
  - `volumes.integration.test.js:97`: `expect(snap.active_tunnels).toBeGreaterThanOrEqual(0)`
  - `backpressure.integration.test.js:97`: same pattern
  - `tunnelMetrics.test.js:71-77`: `expect(event_loop_lag_ms.p50).toBeGreaterThanOrEqual(0)`
- **Expected fix direction**: Replace with specific expected values or meaningful bounds.
- **Regression test required**: No (test quality improvement).

---

**RWT-KNOWN-012**: Duplicate connection cleanup destroys existing tunnel's TCP connections

- **Severity**: High
- **Component**: `server/websocketServer.js`
- **Violates**: RWT-WS-002 ("The existing connection must not be disrupted")
- **Description**: When a second client connects with the same tunnelId, the server correctly rejects the duplicate (close code 1008). However, the rejected connection's `cleanup()` function destroys all TCP connections belonging to the EXISTING tunnel. The root cause: `tunnelId` is assigned the shared tunnel ID (line 119) before `ws.close()` (line 122). When the close event fires, `cleanup()` looks up the tunnel by `tunnelId` and finds the EXISTING tunnel (the duplicate was never registered). The TCP connection teardown loop (lines 153-160) iterates over `tunnel.tcpConnections` and destroys every queue, sender, and TCP socket — without verifying that `this` WebSocket (`ws`) is the one registered in the tunnel object. The ownership guard at lines 168-169 (`registeredTunnel.ws === ws`) only protects state deletion, not TCP connection teardown.
- **Expected fix direction**: Add an ownership check before the TCP connection teardown loop: verify `state[portKey]?.websocketTunnels?.[tunnelId]?.ws === ws` before iterating and destroying `tcpConnections`. If the WebSocket does not own the tunnel, skip TCP connection teardown entirely.
- **Regression test required**: Yes.
- **Status**: **RESOLVED** (2026-08-26). `cleanup()` in `websocketServer.js` now computes `ownsTunnel = registeredTunnel && registeredTunnel.ws === ws` at the top and gates TCP connection teardown, metrics unregister, and state deletion behind it. Duplicate connections only get `clearInterval(interval)` + `ws.terminate()`. Regression tests: `duplicateTunnel.integration.test.js` "duplicate rejection preserves existing tunnel state", "repeated duplicate rejections do not destroy existing tunnel", "owner cleanup still removes tunnel from state" (3 tests).

---

**RWT-KNOWN-013**: TCP sockets missing idle timeout — tunnel alive but not operational

- **Severity**: High
- **Component**: `client/tunnelClient.js`, `server/tcpServer.js`
- **Description**: Client-side TCP sockets to the target (`net.createConnection`) and server-side entry sockets (`net.createServer`) do not call `socket.setTimeout()`. The `tcpIdleTimeoutMs` limit (60s) exists in `tunnelLimits.js` but is never applied. If the target service becomes半-open (TCP ACKs but no application data), the client TCP socket stays alive indefinitely. The `StreamWriteQueue` fills, the `BackpressureSender` pauses the TCP socket, and the connection sits in a paused state with no timeout to break it. The `reconcile()` mechanism only force-resumes when `ws.bufferedAmount === 0 && staleForMs >= 10s`, which does not trigger in a true deadlock (data queued but not flowing). Result: WebSocket is OPEN, heartbeats succeed, but data no longer flows — the classic "alive but not operational" state.
- **Expected fix direction**: Apply `socket.setTimeout(LIMITS.tcpIdleTimeoutMs)` to both client-side target sockets and server-side entry sockets. Handle the `'timeout'` event to trigger cleanup and socket destruction.
- **Regression test required**: Yes.
- **Status**: **RESOLVED** (2026-08-29, amended 2026-08-30). Socket timeouts were initially added to both client-side target sockets and server-side entry sockets, but were **removed** (2026-08-30) because they caused false-positive destruction of legitimate slow-responding services (e.g. SAP Business One, response times > 60s). Dead connection detection now relies on: (1) TCP error/close events (ECONNRESET, FIN), (2) WS ping/pong heartbeat (server terminates dead tunnels), (3) client-side and server-side stream health checks (stalled sender detection). **Client-side onSendError**: `client.on('error')` sends a CLOSE frame to the server via `sender.send('CLOSE')` before cleanup, so the server can immediately tear down its entry socket. **Server-side onSendError (2026-08-30)**: `ensureConn()` in `server/tcpServer.js` now passes an `onSendError` callback to `createBackpressureSender`. When `ws.send()` fails (e.g. ECONNRESET on the WS link), the callback destroys the entry socket immediately instead of swallowing the error. **Server-side stream health check (2026-08-30)**: The server heartbeat in `server/websocketServer.js` now includes a stream health check that mirrors the client-side check. Stalled senders (paused + empty WS buffer + no progress for `tcpIdleTimeoutMs`) are force-destroyed. **Accepted gap**: Half-open TCP detection relies on kernel TCP retransmission timeout (~10-15 min on Linux). Regression tests: `tcpIdleTimeout.test.js` (3 tests), `stallRecovery.integration.test.js` (2 tests), `closeOnErrorRegression.test.js` (2 tests), `serverBackpressureGaps.test.js` (3 tests).

---

**RWT-KNOWN-014**: No application-level stream health monitoring

- **Severity**: Medium
- **Component**: `client/tunnelClient.js`
- **Description**: The client health monitor (`startHealthMonitor`) only checks `lastPongTs` (WebSocket-level liveness). It does not monitor whether TCP streams are actually flowing. A paused TCP socket with a healthy WebSocket = "alive but not operational" from the application perspective.
- **Expected fix direction**: Add stream health checking in the client heartbeat: detect streams where `sender.isPaused() && ws.bufferedAmount === 0 && staleForMs >= staleMs` and force-destroy them.
- **Regression test required**: Yes.
- **Status**: **RESOLVED** (2026-08-29). The client-side heartbeat now includes a stream health check after the reconcile loop. Streams that are paused with an empty WebSocket buffer and no progress for longer than `staleMs` are force-destroyed (queue destroyed, sender destroyed, socket destroyed, metrics unregistered). A `stream_stall_cleanup_total` metric counter tracks these events. Regression tests: `tcpIdleTimeout.test.js` "streamStallCleanup metric", `stallRecovery.integration.test.js` (2 tests).

## 17. Definition of Stable

A release of `@remotelinker/reverse-ws-tunnel` is **not** considered stable if any of the following conditions hold:

1. **The test suite does not pass.** All tests in `__tests__/` must pass without `--forceExit` unless the reason is documented and approved.

2. **The regression suite does not pass.** Every known issue (Section 16) that has been fixed must have a corresponding regression test that passes.

3. **Resource leaks are introduced.** If a modification introduces a new resource leak (timer, socket, listener, registry entry) that is not tracked as a known issue, the release is not stable.

4. **An RWT-* invariant is violated.** If any core invariant (Section 3) is broken without an explicit contract amendment, the release is not stable.

5. **Fundamental integration tests fail.** The `volumes`, `resilience`, and `backpressure` integration suites must all pass.

6. **Tests are disabled to achieve green CI.** Skipping or `.skip`-ing tests to make the suite pass is not acceptable unless the skip is documented with a reason and a plan to re-enable.

7. **Assertions are weakened to achieve green CI.** Replacing a specific assertion with a weaker one (e.g., `toBe(1)` → `toBeGreaterThanOrEqual(0)`) to make a test pass is not acceptable.

---

## 18. Change Log

- **2026-08-26** — RWT-KNOWN-001 resolved. `makeBodyCoalescer()` in `tcpServer.js` now tracks an `active` flag; `flush()` and `push()` are no-ops after `cancel()`. `cleanupConn()` calls `bodyCoalescer.cancel()` before destroying queue/sender, preventing zombie timer from recreating a dead TCP connection. Regression test: `tcpServerBodyCoalescer.test.js` (6 tests).
- **2026-08-26** — RWT-KNOWN-006 resolved. `server/messageHandler.js` APP_PING handler now checks `ws.readyState !== WebSocket.OPEN` before calling `ws.send()`. Regression test: `messageHandler.test.js` (4 tests: OPEN sends pong, CLOSING/CLOSED/CONNECTING do not call send).
- **2026-08-26** — RWT-KNOWN-005 and RWT-KNOWN-007 resolved. `cleanup()` in `websocketServer.js` is now wrapped in `try/finally`; `ws.removeAllListeners()` removed to preserve ws library internal close listener. `integrationHarness.js` `close()` now passes `wsPort` to `stopWebSocketServer()` and awaits it. Four regression tests added to `harnessClose.integration.test.js`: port freed after close, consecutive harnesses no leak, WS terminate triggers cleanup and stopWebSocketServer resolves, double cleanup idempotent. R4 and R6 race classifications updated to "Eliminated".
- **2026-08-26** — RWT-KNOWN-002 resolved. `forceClosePort()` in `tcpServer.js` now calls `takeover.close()` in the EADDRINUSE error handler before resolving. The `setTimeout` delay was removed. Regression test: `tcpServerCleanup.test.js` "takeover.close() is called when listen() gets EADDRINUSE".
- **2026-08-26** — RWT-KNOWN-003 resolved. `watchLogConfig()` in `logger.js` now tracks the currently watched file via `watchedFilePath` and calls `fs.unwatchFile()` before creating a new watcher. Added `dispose()` function for explicit cleanup. Regression tests: `logger.test.js` watcher accumulation and unwatch-before-watch tests.
- **2026-08-26** — RWT-KNOWN-004 resolved. `destroy()` in `backpressureSender.js` now has `if (destroyed) return;` early-return guard. The `ws.send` completion callback also checks `if (destroyed) return;` to prevent pending callbacks from resurrecting the sender. Nine regression tests added to `backpressureSender.test.js`.
- **2026-08-26** — RWT-KNOWN-008 resolved. `close()` in `proxyServer.js` now checks `server.listening` before calling `server.close()`. If the server is not listening, `close()` returns immediately. Three regression tests added to `proxyServer.test.js`.
- **2026-08-26** — RWT-KNOWN-009 resolved. `heartBeat()` in `tunnelClient.js` now tracks `pongHandler` and `pongTimeout` references. `cleanupPong()` removes the pong listener and clears the timeout. Called before each new ping cycle, on pong arrival, on timeout, and on WS close. Maximum one pong listener active per cycle. Nine regression tests added to `tunnelClientHeartbeat.test.js`.
- **2026-08-26** — RWT-KNOWN-010 resolved. The `ws.on('message', ...)` callback in `websocketServer.js` is now `async`. Each `handleParsedMessage()` call is `await`ed inside the frame loop, serializing CONFIG and DATA dispatch. Errors are caught by an outer `try/catch` preventing unhandled rejections. R3 race classification updated to "Eliminated". Seven regression tests added to `configDataOrdering.test.js`.
- **2026-08-26** — RWT-KNOWN-012 resolved. `cleanup()` in `websocketServer.js` now checks WebSocket ownership (`registeredTunnel.ws === ws`) before tearing down TCP connections, unregistering metrics, or deleting tunnel state. Rejected duplicates only clear their heartbeat interval and terminate their socket. RWT-WS-002 no longer has a known violation. Regression tests: `duplicateTunnel.integration.test.js` (3 tests: duplicate rejection preserves state, repeated rejections do not destroy, owner cleanup still removes).
- **2026-08-29** — RWT-KNOWN-013 and RWT-KNOWN-014 resolved. TCP sockets initially had idle timeouts (`tcpIdleTimeoutMs`); client-side heartbeat includes stream health check that force-destroys stalled streams. New metric `stream_stall_cleanup_total`. Added `getLastProgressTs()` to `BackpressureSender`. `client.on('error')` and `client.on('timeout')` now send CLOSE frame to server before cleanup. Regression tests: `tcpIdleTimeout.test.js` (5 tests), `stallRecovery.integration.test.js` (2 tests), `closeOnErrorRegression.test.js` (4 tests).
- **2026-08-30** — RWT-KNOWN-013 server-side gaps resolved. `ensureConn()` in `server/tcpServer.js` now passes `onSendError` to `createBackpressureSender` — entry socket destroyed on ws.send failure. Server heartbeat in `websocketServer.js` now includes stream health check mirroring client-side: stalled senders (paused + empty WS buffer + no progress for `tcpIdleTimeoutMs`) force-destroyed. Regression test: `serverBackpressureGaps.test.js` (3 tests).
- **2026-08-30** — RWT-KNOWN-013 TCP idle timeouts removed. `socket.setTimeout()` removed from both entry socket (server/tcpServer.js) and target socket (client/tunnelClient.js) because timeouts caused false-positive destruction of legitimate slow-responding services (SAP Business One). Dead connection detection now relies on TCP error/close events, WS heartbeat, and stream health checks. Half-open TCP detection relies on kernel TCP retransmission timeout (~10-15 min). Regression tests updated: `tcpIdleTimeout.test.js` (3 tests), `closeOnErrorRegression.test.js` (2 tests).
- **2026-08-26** — Initial stability contract created from repository audit. 17 core invariants defined. 11 known issues documented. Test pyramid and AI development rules established.
