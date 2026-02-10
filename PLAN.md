# ARONIA Protocol Implementation Plan

> **Status: Phase 1-4 Complete ✅** | Core protocol and trust features implemented

This document breaks down the implementation of the ARONIA realtime P2P agent communication protocol into actionable phases and tasks.

## Quick Start

```bash
# Install dependencies
bun install

# Run tests
bun test

# Start a node
bun run cli.ts start --topic my-swarm

# See example usage
bun run examples/simple-chat.ts
```

## Implementation Progress

- ✅ **Phase 1:** Foundation & Core Node (COMPLETE)
- ✅ **Phase 2:** Protocol Layer (COMPLETE) 
- ✅ **Phase 3:** RPC & Multiplexing (COMPLETE)
- ✅ **Phase 4:** Security, Authentication & Trust (COMPLETE)
- 🔄 **Phase 5:** Resilience & Error Handling (Partial)
- ⏳ **Phase 6:** Advanced Features (Pending)
- ⏳ **Phase 7:** Integration & Tooling (Partial)

## Overview

ARONIA is a realtime P2P agent communication system using Hyperswarm for mesh networking. Unlike store-and-forward systems (QUINCE), ARONIA provides:
- Sub-100ms message latency through persistent connections
- Automatic peer discovery via DHT
- Encrypted E2E streams with Ed25519 authentication
- At-most-once delivery semantics
- Presence awareness and heartbeat detection

---

## Phase 1: Foundation & Core Node ✅ COMPLETED

**Goal:** Get a basic ARONIA node running with Hyperswarm integration

### 1.1 Project Setup ✅
- [x] Initialize Bun project with TypeScript
- [x] Install dependencies:
  - `hyperswarm` - DHT and P2P networking
  - `@hyperswarm/secret-stream` - Encrypted streams
  - `hypercore-crypto` - Cryptographic utilities
  - `bun:test` for testing (built-in)
- [x] Set up project structure:
  ```
  src/
    node.ts          # Core AroniaNode class ✅
    peer.ts          # PeerConnection wrapper ✅
    protocol.ts      # Message framing and serialization ✅
    types.ts         # TypeScript interfaces ✅
    index.ts         # Main exports ✅
  tests/
    node.test.ts     # Integration tests ✅
    protocol.test.ts # Unit tests ✅
  examples/
    simple-chat.ts   # Usage example ✅
  cli.ts             # CLI tool ✅
  ```

### 1.2 Core Node Implementation ✅
- [x] Implement `AroniaNode` class extending EventEmitter
- [x] Initialize Hyperswarm with Ed25519 keypair
- [x] Join topic with `swarm.join()` for continuous discovery
- [x] Handle incoming connections via `swarm.on('connection')`
- [x] Implement graceful shutdown with `swarm.destroy()`

**Key Code Pattern:**
```typescript
class AroniaNode extends EventEmitter {
  private swarm: Hyperswarm
  private peers = new Map<string, PeerConnection>()
  
  constructor(opts: AroniaNodeOptions) {
    super()
    this.swarm = new Hyperswarm({ keyPair: opts.keyPair })
    this.swarm.on('connection', this.handleConnection.bind(this))
    this.swarm.join(crypto.hash(opts.topic), { server: true, client: true })
  }
}
```

### 1.3 Peer Connection Wrapper
- [ ] Create `PeerConnection` class to wrap NoiseSecretStream
- [ ] Perform Noise XX handshake with mutual authentication
- [ ] Extract and store remote public key
- [ ] Implement basic `send()` method on the stream
- [ ] Handle stream close events and cleanup

**Acceptance Criteria:**
- Two nodes can discover each other via DHT
- Connections are encrypted with Noise protocol
- Peers can send raw messages to each other
- Clean disconnection handling

---

## Phase 2: Protocol Layer ✅ COMPLETED

**Goal:** Implement the ARONIA wire format and message framing

### 2.1 Binary Message Framing ✅
- [x] Define message frame structure (see ARONIA-PROTOCOL.md §4.2)
- [x] Implement frame serialization:
  - Length (32 bits)
  - Version (8 bits)
  - Type (8 bits)
  - Flags (16 bits)
  - Timestamp (64 bits)
  - Sender Public Key (32 bytes)
  - Payload (variable)
  - Ed25519 Signature (64 bytes)
- [x] Implement frame deserialization with validation
- [x] Add type constants (CONTROL, REQUEST, RESPONSE, EVENT, STREAM_DATA, STREAM_END, INTRODUCE)
- [x] Implement payload signing and signature verification

**Implementation Note:** Uses Buffer methods for precise binary layout control.

### 2.2 Message Types ✅
- [x] **CONTROL (0x01):** Heartbeat and presence messages
- [x] **EVENT (0x04):** Fire-and-forget messages (default)
- [x] **REQUEST (0x02):** RPC-style requests with ID
- [x] **RESPONSE (0x03):** RPC responses matching request IDs
- [x] **INTRODUCE (0x07):** Peer introduction messages for trust delegation

### 2.3 Heartbeat & Presence
- [ ] Send periodic heartbeat messages (default: 30s interval)
- [ ] Track last seen timestamp for each peer
- [ ] Emit `peer:offline` when heartbeat timeout (default: 90s)
- [ ] Emit `peer:online` when new peer connects
- [ ] Include capabilities in initial handshake exchange

**Acceptance Criteria:**
- Messages are properly framed and signed
- Heartbeats maintain connection liveness
- Offline peers are detected within 90 seconds
- Malformed frames are rejected

---

## Phase 3: RPC & Multiplexing ✅ COMPLETED

**Goal:** Enable request/response patterns over persistent streams

### 3.1 Request/Response Multiplexing ✅
- [x] Generate unique request IDs (counter-based with timestamp)
- [x] Track pending requests in a Map (id → {resolve, reject, timer})
- [x] Implement `request(method, params, timeout)` API
- [x] Route responses back to correct request handler
- [x] Implement timeout handling and cleanup

**API Design:**
```typescript
interface RequestOptions {
  timeout?: number  // milliseconds
}

async request(
  pubkey: string, 
  method: string, 
  params: unknown, 
  opts?: RequestOptions
): Promise<unknown>
```

### 3.2 Method Registry ✅
- [x] Create RPC method registry on AroniaNode
- [x] Implement `registerMethod(name, handler)` API
- [x] Route incoming REQUEST messages to registered handlers
- [x] Send RESPONSE with result or error
- [x] Support async handlers
- [x] Built-in `ping` method for health checks

**API Design:**
```typescript
registerMethod(name: string, handler: (params: unknown, peer: PeerConnection) => Promise<unknown>)
```

### 3.3 Fire-and-Forget Events ✅
- [x] Implement `send(pubkey, message)` for one-way messages
- [x] Fail fast if peer offline (throw PeerOfflineError)
- [x] Implement `broadcast(message)` to all online peers

**Acceptance Criteria:**
- RPC requests receive responses within timeout ✅
- Multiple requests can be in-flight simultaneously ✅
- Unregistered methods return proper error response ✅
- Broadcast sends to all online peers, returns counts ✅

---

## Phase 4: Security, Authentication & Trust ✅ COMPLETED

**Goal:** Implement whitelist-based authentication with introductions and transitive trust

### 4.1 Whitelist Enforcement ✅
- [x] Add `whitelist` option to AroniaNode (Set of hex pubkeys)
- [x] After Noise handshake, check remote pubkey against whitelist
- [x] Destroy stream immediately if not whitelisted
- [x] Emit `peer:rejected` event with pubkey

### 4.2 Capability Exchange ✅
- [x] Define capability exchange payload format:
  ```typescript
  interface Capabilities {
    agent: string      // e.g. "ci-bot"
    version: string    // e.g. "2.1"
    accepts: string[]  // e.g. ["review", "deploy"]
  }
  ```
- [x] Send capabilities immediately after handshake
- [x] Store peer capabilities in PeerConnection
- [x] Make capabilities available via `getPeerInfo(pubkey)`

### 4.3 Message Integrity ✅
- [x] Sign all outgoing message frames
- [x] Verify signatures on all incoming frames
- [x] Reject messages with invalid signatures
- [x] Use Ed25519 for signing/verification

### 4.4 Introductions (Trust Delegation) ✅

Introductions allow a trusted peer to vouch for a third party, enabling network growth without manual key exchange.

**Why Introductions Matter in ARONIA:**
- ARONIA requires persistent connections—manually adding 100 peers doesn't scale
- Agent swarms grow dynamically (auto-scaling, failover, new deployments)
- Manual out-of-band key exchange is operationally expensive
- Trust can be transitive: if Alice trusts Bob, and Bob vouches for Charlie, Alice can auto-accept Charlie

**How It Works:**

```
Alice (coordinator)    Bob (worker)           Charlie (new worker)
      │                      │                         │
      │◄─────connected──────►│                         │
      │                      │                         │
      │◄───INTRODUCE Charlie─┤                         │
      │   {pubkey, alias,    │                         │
      │    capabilities,     │                         │
      │    signature}        │                         │
      │                      │                         │
      │───verify signature───┤                         │
      │   (must be from      │                         │
      │    connected peer)   │                         │
      │                      │                         │
      │───accept/queue───────┤                         │
      │   (auto-accept if    │                         │
      │    Bob is trusted)   │                         │
      │                      │                         │
      ├──────────────────────┼─────►connects to Charlie
      │   (Alice adds to     │   (if online, via DHT   │
      │    whitelist)        │    topic)               │
```

**Implementation:**

- [x] **New Message Type: INTRODUCE (0x07)**
  - Payload includes: `pubkey`, `alias`, `capabilities`, `introducerPubkey`
  - Signed by introducer using their Ed25519 key
  - Include optional `message` field for context (e.g., "Charlie handles deployments")

- [x] **Introduction Validation:**
  - Verify introducer is currently connected and whitelisted
  - Verify introduction signature using introducer's pubkey
  - Check introduced pubkey not already in whitelist
  - Validate timestamp (reject stale introductions > 24h old)

- [x] **Pending Introductions Store:**
  - Store in `pendingIntroductions` Map (pubkey → Introduction)
  - Emit `introduction:received` event with full details
  - Allow manual accept/reject via API
  - Auto-cleanup old pending introductions (configurable TTL)

- [x] **APIs:**
  ```typescript
  // Send introduction to connected peer
  async introduce(peerPubkey: string, targetPubkey: string, alias: string, capabilities: Capabilities, message?: string): Promise<void>
  
  // Accept pending introduction
  async acceptIntroduction(pubkey: string): Promise<void>
  
  // Reject/clear introduction
  async rejectIntroduction(pubkey: string): Promise<void>
  
  // List pending introductions
  getPendingIntroductions(): PendingIntroduction[]
  ```

### 4.5 Transitive Trust (Auto-Accept) ✅

Transitive trust enables automatic acceptance of introductions from designated peers, creating a web of trust for dynamic agent swarms.

**Use Cases:**
- **Auto-scaling groups:** New workers introduced by coordinator are immediately trusted
- **Hierarchical topologies:** Managers trust supervisors, who trust workers
- **Federated networks:** Organizations can delegate trust to partner organizations

**Implementation:**

- [x] **Trust Configuration:**
  ```typescript
  interface TrustConfig {
    // Auto-accept introductions from these peers
    autoAcceptFrom: Set<string> // pubkey hex strings
    
    // Maximum introduction chain depth (prevent infinite trust chains)
    maxTrustDepth: number // default: 3
    
    // Require explicit approval for certain capabilities
    requireApprovalFor: string[] // e.g., ["admin", "deploy-prod"]
  }
  ```

- [x] **Trust Chain Tracking:**
  - Include `trustPath` array in introductions (chain of introducers)
  - Verify chain depth doesn't exceed `maxTrustDepth`
  - Detect and prevent circular trust references
  - Store trust provenance for audit purposes

- [x] **Conditional Auto-Accept:**
  - Auto-accept based on introducer AND capability match
  - Example: "Auto-accept deployment agents from coordinator, but queue review agents"
  - Override with explicit manual acceptance required

- [x] **APIs:**
  ```typescript
  // Configure trust for a peer
  setTrust(pubkey: string, autoAccept: boolean): void
  
  // Get trust configuration
  getTrust(pubkey: string): boolean
  
  // Revoke trust (also removes all peers introduced by this peer)
  revokeTrust(pubkey: string, cascade: boolean): void
  ```

### 4.6 Introduction Lifecycle in ARONIA

**Differences from QUINCE:**

| Aspect | QUINCE (Store-and-Forward) | ARONIA (Realtime) |
|--------|---------------------------|-------------------|
| **Delivery** | Queued if introducer offline | Fails fast if introducer not connected |
| **Acceptance** | Stored to disk, async decision | Realtime decision, immediate connection attempt |
| **Connection** | Manual: accepted → add to config | Automatic: DHT discovery + connect |
| **Offline Peers** | Introduction waits in queue | Application must retry introduction later |
| **Trust Propagation** | Static config files | Dynamic through persistent connections |

**ARONIA-Specific Behavior:**

```typescript
// On accepting an introduction:
async acceptIntroduction(pubkey: string) {
  // 1. Add to whitelist
  this.whitelist.add(pubkey)
  
  // 2. Emit event for application layer
  this.emit('introduction:accepted', { pubkey, introducer })
  
  // 3. Attempt immediate connection (ARONIA is realtime)
  if (this.isPeerOnline(pubkey)) {
    await this.connectToPeer(pubkey)
  } else {
    // Peer offline - application can choose to:
    // a) Wait for them to discover us via DHT
    // b) Retry connection later
    // c) Queue for QUINCE-style async fallback
    this.emit('peer:pending', pubkey)
  }
  
  // 4. Clear from pending
  this.pendingIntroductions.delete(pubkey)
}
```

**Acceptance Criteria:**
- Non-whitelisted peers are rejected at connection time ✅
- All messages are signed and verified ✅
- Capability exchange happens automatically ✅
- Invalid signatures result in connection termination ✅
- Introductions can be sent to connected peers ✅
- Introductions are signed and validated ✅
- Auto-accept works for configured trusted peers ✅
- Trust depth limits prevent infinite chains ✅
- Manual accept/reject APIs work correctly ✅
- Accepted introductions result in immediate connection attempts ✅

---

## Phase 5: Resilience & Error Handling

**Goal:** Handle network failures gracefully

### 5.1 Connection Management
- [ ] Implement automatic reconnection with exponential backoff
- [ ] Track connection state (connecting, connected, disconnecting, disconnected)
- [ ] Implement max reconnection attempts (default: 10)
- [ ] Emit connection state changes

### 5.2 Backpressure Handling
- [ ] Monitor stream.write() return values
- [ ] Implement bounded send buffer per peer
- [ ] Apply backpressure to producers when buffer full
- [ ] Emit `backpressure` event for application handling

### 5.3 Error Types
Define and use specific error classes:
- [ ] `PeerOfflineError` - Target peer not connected
- [ ] `RequestTimeoutError` - RPC request timeout
- [ ] `AuthenticationError` - Whitelist or signature failure
- [ ] `ProtocolError` - Malformed message or frame
- [ ] `IntroductionError` - Invalid or rejected introduction

### 5.4 Partition Detection
- [ ] Detect connection drops quickly (within 5-10s)
- [ ] Emit `partition` event when connection lost
- [ ] Provide partition duration tracking
- [ ] Support application-level partition handling

### 5.5 Introduction Failure Handling
- [ ] Handle introducer disconnection during introduction flow
- [ ] Implement retry logic for failed auto-accept connections
- [ ] Add introduction timeout (configurable, default: 5 minutes)
- [ ] Provide clear error messages for trust violations

**Acceptance Criteria:**
- Network partitions are detected within 10 seconds
- Reconnection follows exponential backoff
- Backpressure prevents unbounded memory growth
- All errors are typed and informative

---

## Phase 6: Advanced Features

**Goal:** Add production-ready features

### 6.1 Topic-Based Multicast
- [ ] Support multiple topic subscriptions per node
- [ ] Implement topic-specific peer lists
- [ ] Enable broadcast to specific topics only
- [ ] Cross-topic peer deduplication

### 6.2 Metrics & Observability
- [ ] Track connection counts (active, total)
- [ ] Track message counts (sent, received, dropped)
- [ ] Track latency histograms for RPC calls
- [ ] Track introduction metrics (sent, accepted, rejected, auto-accepted)
- [ ] Track trust chain depth distribution
- [ ] Expose metrics via API or events

### 6.3 Configuration Options
Add configuration for:
- [ ] `heartbeatInterval` (default: 30000ms)
- [ ] `heartbeatTimeout` (default: 90000ms)
- [ ] `reconnectMaxAttempts` (default: 10)
- [ ] `reconnectBaseDelay` (default: 1000ms)
- [ ] `sendBufferSize` (default: 1000 messages)
- [ ] `defaultRequestTimeout` (default: 30000ms)
- [ ] `introductionMaxAge` (default: 86400000ms = 24h)
- [ ] `maxTrustDepth` (default: 3)
- [ ] `autoAcceptIntroductions` (default: false)

### 6.4 Testing Infrastructure
- [ ] Unit tests for protocol framing
- [ ] Integration tests for node-to-node communication
- [ ] Network partition simulation tests
- [ ] Load tests for many concurrent peers
- [ ] Introduction flow tests (manual and auto-accept)
- [ ] Trust chain validation tests
- [ ] Circular trust detection tests

**Acceptance Criteria:**
- All features have comprehensive tests
- Metrics provide visibility into system health
- Configuration options are well-documented
- System handles 100+ concurrent peers

---

## Phase 7: Integration & Tooling

**Goal:** Make ARONIA usable in real deployments

### 7.1 CLI Tool
- [ ] Create `aronia` CLI for testing and debugging
- [ ] Support `aronia node --topic <topic>` to start a node
- [ ] Support `aronia send --to <pubkey> --message <msg>`
- [ ] Support `aronia peers` to list connected peers
- [ ] Support `aronia discover` to find peers on a topic
- [ ] Support `aronia introduce --to <pubkey> --target <target-pubkey>`
- [ ] Support `aronia introductions` to list pending introductions
- [ ] Support `aronia accept-introduction <pubkey>`
- [ ] Support `aronia trust <pubkey>` to auto-accept from peer

### 7.2 Example Applications
- [ ] Simple chat application (two nodes)
- [ ] Echo server example
- [ ] Multi-agent task distribution example
- [ ] Presence monitoring dashboard
- [ ] Auto-scaling agent swarm with introductions

### 7.3 Documentation
- [ ] API reference documentation
- [ ] Tutorial: Getting started with ARONIA
- [ ] Tutorial: Building trust networks with introductions
- [ ] Deployment guide
- [ ] Troubleshooting guide
- [ ] Security best practices (trust depth, capability restrictions)

### 7.4 QUINCE Integration (Future)
- [ ] Design spillover mechanism for offline peers
- [ ] Implement hybrid mode: ARONIA (online) → QUINCE (offline)
- [ ] Automatic reconciliation on reconnection

---

## Implementation Order

### Week 1-2: Foundation
1. Project setup with Bun + TypeScript
2. Install Hyperswarm and crypto dependencies
3. Implement basic AroniaNode with discovery
4. Implement PeerConnection wrapper
5. First integration test (two nodes connect)

### Week 3-4: Protocol
1. Implement binary message framing
2. Add message types (CONTROL, EVENT, REQUEST, RESPONSE)
3. Implement heartbeat mechanism
4. Add presence tracking and offline detection
5. Unit tests for protocol layer

### Week 5-6: RPC, Security & Trust
1. Implement request/response multiplexing
2. Add method registry
3. Implement whitelist authentication
4. Add capability exchange
5. Message signing and verification
6. **Implement INTRODUCE message type and validation**
7. **Build pending introductions store**
8. **Add transitive trust configuration**
9. **Implement auto-accept logic**

### Week 7-8: Resilience & Trust Edge Cases
1. Automatic reconnection with backoff
2. Backpressure handling
3. Comprehensive error types
4. Partition detection
5. **Introduction failure handling (introducer disconnects mid-flow)**
6. **Trust chain validation and circular reference detection**
7. Edge case testing

### Week 9+: Features & Polish
1. Topic multicast
2. Metrics and observability
3. CLI tool
4. Example applications
5. Documentation

---

## Key Decisions to Make

1. **Storage Spillover:** Should we implement a small local queue for brief partitions? (Currently: No, pure realtime)
2. **Browser Support:** WebRTC for browser agents, or skip browser support initially? (Currently: Skip for MVP)
3. **Consensus:** Include Raft/PBFT primitives, or stay transport-only? (Currently: Transport-only)
4. **Max Message Size:** What should be the hard limit? (Suggestion: 1MB default)

---

## Dependencies

```json
{
  "dependencies": {
    "hyperswarm": "^4.x",
    "@hyperswarm/secret-stream": "^6.x",
    "hypercore-crypto": "^3.x",
    "bun-types": "latest"
  },
  "devDependencies": {
    "typescript": "^5.x"
  }
}
```

---

## Success Criteria

- [ ] Two nodes can discover and connect via DHT within 5 seconds
- [ ] Message latency is under 100ms for connected peers
- [ ] Offline peers are detected within 90 seconds
- [ ] RPC requests work with proper timeout handling
- [ ] Whitelist authentication rejects unauthorized peers
- [ ] All messages are signed and verified
- [ ] System handles 100+ concurrent connections
- [ ] Comprehensive test coverage (>80%)
- [ ] Working CLI tool for debugging
- [ ] **Peers can send signed introductions for third parties**
- [ ] **Introductions are validated (signature, introducer connected, not expired)**
- [ ] **Auto-accept works for configured trusted introducers**
- [ ] **Trust depth limits prevent infinite chains**
- [ ] **Circular trust references are detected and rejected**
- [ ] **Accepted introductions result in immediate connection attempts**

---

## Design Deep Dive: Introductions in ARONIA vs QUINCE

### Why Introductions Are Critical for ARONIA

QUINCE is a **store-and-forward** system—introductions sit in a queue until the recipient checks their inbox. ARONIA is **realtime**—introductions happen live over persistent connections. This difference changes everything:

**1. Operational Scaling**

In a 100-node agent swarm:
- **Without introductions:** Manual out-of-band key exchange for 100 × 99 = 9,900 pairwise connections. Operationally impossible.
- **With introductions:** Coordinator introduces each new agent to the swarm. 99 introductions total. Manageable.

**2. Dynamic Topologies**

Agent swarms are not static:
- Auto-scaling adds/removes workers constantly
- Failover creates new leader election
- Regional deployments come online/offline
- **Introductions let the mesh self-configure** as topology changes

**3. Trust as a Graph**

Transitive trust creates a web-of-trust model:
```
Coordinator (root of trust)
    ├── introduces → Worker Pool A
    │       └── worker-a1 introduces → worker-a2, worker-a3
    ├── introduces → Worker Pool B
    │       └── worker-b1 introduces → worker-b2
    └── introduces → Monitoring Agents
```

Benefits:
- **Hierarchical trust:** Delegate introduction rights to pool managers
- **Federated networks:** Partner organizations trust each other's coordinators
- **Audit trail:** Every peer's trust chain is cryptographically traceable

### Key Differences: QUINCE vs ARONIA

| Aspect | QUINCE | ARONIA |
|--------|--------|--------|
| **Introduction Timing** | Async (queued) | Realtime (immediate) |
| **Acceptance Flow** | User reviews queue → clicks accept | Event-driven: accept → immediate connection attempt |
| **Connection** | Manual: add to config, restart | Automatic: DHT discovery + connect |
| **Offline Handling** | Introduction waits in queue | Fails fast (application must retry) |
| **Trust Propagation** | Static config files | Dynamic through persistent connections |

### Threat Model Considerations

**Risk: Rogue Introducer**
- If Bob is compromised, he can introduce malicious peers to Alice
- **Mitigation:** Trust depth limits, capability restrictions, manual approval for sensitive roles

**Risk: Trust Chain Poisoning**
- Mallory gets introduced by Bob, then introduces evil nodes claiming Bob vouched for them
- **Mitigation:** Cryptographic chain tracking, introducer signature verification at every hop

**Risk: Introduction Replay**
- Attacker intercepts and replays old introduction
- **Mitigation:** Timestamp validation (reject >24h old), nonce verification

**Risk: Circular Trust**
- Alice trusts Bob, Bob trusts Charlie, Charlie (falsely) claims Alice trusts him
- **Mitigation:** Graph cycle detection, canonical pubkey ordering in trust paths

### Recommendation: Hybrid Trust Model

For production deployments:
1. **Use transitive trust** for standard worker pools (auto-accept)
2. **Require manual approval** for administrative/management roles
3. **Set trust depth limit** to 3 (prevents infinite chains)
4. **Audit all introductions** via event logs
5. **Revoke trust** cascades (remove all peers introduced by compromised node)

---

## Open Questions

1. Should we support multiple topics per node in MVP?
2. Do we need connection pooling (multiple streams per peer)?
3. Should we implement compression (zstd) immediately or later?
4. What's the target environment - servers only, or edge devices too?
5. **Should we support introduction revocation?** (If Alice accepts Charlie from Bob, then Bob is compromised, should Charlie be auto-removed?)
6. **Should trust chains be stored persistently or just in-memory?** (QUINCE stores to disk, ARONIA is ephemeral—what's the right tradeoff?)
7. **Should we allow negative introductions?** ("Do NOT trust this pubkey")

Document answers to these as decisions are made.
