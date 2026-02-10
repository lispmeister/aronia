# ARONIA Protocol: Realtime P2P Agent Communication

> *Aronia melanocarpa — the black chokeberry, thriving in harsh conditions through interconnected root systems*

## Executive Summary

ARONIA reimagines agent-to-agent communication as a **realtime mesh network** rather than a store-and-forward mail system. While QUINCE treats communication as asynchronous email, ARONIA treats it as persistent, bidirectional streams. Agents maintain long-lived connections to a swarm of peers, enabling sub-100ms message propagation, presence awareness, and collaborative state synchronization.

**Core Insight**: The shift from "mailbox" to "continuous presence" changes everything—architecture, guarantees, failure modes, and use cases.

---

## 1. Architectural Philosophy

### 1.1 QUINCE: Store-and-Forward Semantics

```
┌─────────┐     HTTP      ┌─────────┐   Hyperswarm   ┌─────────┐
│  Agent  │◄──────────────►│ QUINCE  │◄──────────────►│ QUINCE  │
│  (Any)  │   (localhost) │  Node   │  (ephemeral)   │  Node   │
└─────────┘               └─────────┘                └─────────┘
                              │                          │
                              ▼                          ▼
                         ┌─────────┐                ┌─────────┐
                         │  Queue  │                │  Queue  │
                         │(persist)│                │(persist)│
                         └─────────┘                └─────────┘
```

**Characteristics:**
- Messages are **durable first**, delivered second
- Peers connect only when needed (ephemeral connections)
- Offline tolerance via persistent queues
- At-least-once delivery semantics
- HTTP request/response API (stateless)

### 1.2 ARONIA: Realtime Stream Semantics

```
┌─────────┐   Persistent   ┌─────────┐   DHT Discovery   ┌─────────┐
│  Agent  │◄──────────────►│ ARONIA  │◄─────────────────►│ ARONIA  │
│  (Any)  │   WebSocket/   │  Node   │   Swarm Topics    │  Node   │
│         │   Direct P2P   │         │                   │         │
└─────────┘                └────┬────┘                   └────┬────┘
                                │                             │
                                ▼                             ▼
                          ┌───────────┐                 ┌───────────┐
                          │  Stream   │◄───────────────►│  Stream   │
                          │ (ephemeral│  Encrypted E2E  │(ephemeral│
                          │  state)   │   Noise Stream  │  state)   │
                          └───────────┘                 └───────────┘
```

**Characteristics:**
- Connections are **persistent first**, messages flow through them
- Peers maintain long-lived connections (minutes to hours)
- Online-only delivery (fail fast if unreachable)
- At-most-once delivery (fire-and-forget through open streams)
- Streaming API (stateful, bidirectional)

---

## 2. What Changes: Store-and-Forward → Realtime

### 2.1 Connection Model

| Aspect | QUINCE (Store-and-Forward) | ARONIA (Realtime) |
|--------|---------------------------|-------------------|
| **Connection lifetime** | Ephemeral (per-message) | Persistent (session-based) |
| **Connection trigger** | Outbound message or poll | Continuous background maintenance |
| **Resource cost** | Low (connect-on-demand) | Higher (keep-alive, heartbeat) |
| **Latency** | Seconds to hours (queue-based) | Sub-100ms (direct stream) |
| **Bandwidth overhead** | Connection setup per message | Amortized over many messages |

**Key Change**: ARONIA inverts the relationship—instead of "connect to send," it "sends through existing connections." If no connection exists, the message fails immediately (fail-fast).

### 2.2 Message Delivery Semantics

**QUINCE (At-Least-Once):**
```
Send → Queue → Retry Loop → Deliver → ACK → Remove from Queue
                ↑___________↓ (exponential backoff)
```

**ARONIA (At-Most-Once):**
```
Send → Active Stream? → Yes → Deliver → Success
              ↓ No
           Fail Immediately → Optional: Retry at Application Layer
```

**Implications:**
- ARONIA cannot guarantee delivery to offline peers
- Applications must handle "peer unavailable" as a first-class concern
- Message ordering is preserved per-stream but not globally
- No persistent queue means no disk I/O bottleneck

### 2.3 Presence and Discovery

**QUINCE:**
- Presence is polled (`GET /api/peers`)
- Discovery is manual (public key exchange)
- Online status is cached/stale

**ARONIA:**
- Presence is push-based (heartbeat streams)
- Discovery is automatic (DHT topic subscription)
- Online status is realtime (connection state)

**Hyperswarm enables this via:**
- **DHT Announce**: Peers announce themselves under topic hashes
- **Hole Punching**: NAT traversal for direct P2P (no relays)
- **Secret Streams**: Encrypted, authenticated channels over raw TCP/UDP

### 2.4 State Management

**QUINCE:**
- Stateless HTTP API
- Each request is independent
- State lives on disk (queues, inbox)

**ARONIA:**
- Stateful stream connections
- Shared session state between peers
- State lives in memory (connections, presence)

**Trade-off**: ARONIA nodes consume more RAM but zero disk I/O for message flow.

---

## 3. How Hyperswarm Enables Realtime

### 3.1 Hyperswarm Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Hyperswarm DHT                        │
│  (Mainline DHT - same as BitTorrent, millions of nodes)      │
├─────────────────────────────────────────────────────────────┤
│  Topic: hash('aronia:agents:v1')                            │
│                                                               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │   Node A     │◄──►│   Node B     │◄──►│   Node C     │   │
│  │ (announced)  │    │ (discovered) │    │ (announced)  │   │
│  └──────────────┘    └──────────────┘    └──────────────┘   │
│          │                   │                   │           │
│          └───────────────────┼───────────────────┘           │
│                              ▼                               │
│                    Direct P2P Connection                     │
│              (UDP hole punching + TCP fallback)              │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Realtime Mechanisms

**A. Continuous Discovery (DHT Topic Subscription)**

```javascript
// Announcing presence to the swarm
const swarm = new Hyperswarm()
const topic = crypto.hash('aronia:agent-network') // 32-byte topic

// Join the topic - continuously announces and discovers
swarm.join(topic, { server: true, client: true })

// Event fires when ANY peer comes online
swarm.on('connection', (conn, peerInfo) => {
  // conn is a NoiseSecretStream - encrypted E2E
  // This fires within seconds of a peer joining the topic
})
```

**Key capability**: Peers discover each other automatically without manual key exchange. The DHT acts as a decentralized directory service.

**B. NAT Traversal (Hole Punching)**

```
Alice (NAT)              DHT Server            Bob (NAT)
    │                         │                    │
    │───Announce topic────────►│                    │
    │                         │◄────Announce topic──│
    │                         │                    │
    │◄──Bob's IP:port────────│                    │
    │                         │───Alice's IP:port──►│
    │                         │                    │
    │──────UDP hole punch─────┼───────────────────►│
    │◄────────────────────────│────────────────────│
    │                         │                    │
    │◄────Direct TCP connection established───────►│
```

**Success rate**: ~85-95% of NATs can be punched through. Falls back to TCP relay for symmetric NATs.

**C. Persistent Secret Streams**

```javascript
// Once connected, Hyperswarm provides a NoiseSecretStream
// This is NOT a raw socket - it's an encrypted, authenticated duplex stream

const stream = new NoiseSecretStream(isInitiator, rawSocket, {
  pattern: 'XX', // mutual authentication
  staticKeyPair: myKeyPair // Ed25519 keys
})

// Stream stays open indefinitely
// Backpressure handled automatically
// Encryption: XChaCha20-Poly1305
// Authentication: Ed25519 signatures during handshake
```

**D. Topic-Based Multicast**

Unlike QUICNE's 1:1 connections, ARONIA can use topic broadcasting:

```javascript
// Send to ALL peers subscribed to a topic
swarm.broadcast(topic, message)

// Or iterate connections for targeted multicast
for (const peer of swarm.peers) {
  if (peer.capabilities.includes('review-agent')) {
    peer.stream.write(message)
  }
}
```

### 3.3 Why This Is "Realtime"

| Mechanism | Latency | Description |
|-----------|---------|-------------|
| DHT lookup | 1-3 seconds | Find peers by topic |
| Hole punching | 0.5-2 seconds | Establish direct connection |
| Stream write | 10-100ms | Message delivery through open stream |
| Reconnection | <1 second | Automatic on connection drop |

**The critical insight**: After initial connection (amortized cost), messages travel through an already-open encrypted stream. No TCP handshake, no TLS negotiation, no HTTP overhead—just a frame on an existing connection.

---

## 4. Protocol Design: ARONIA Wire Format

### 4.1 Connection Lifecycle

```
┌──────────┐                                    ┌──────────┐
│  Alice   │                                    │   Bob    │
└────┬─────┘                                    └────┬─────┘
     │                                               │
     │  1. DHT Discovery (find Bob via topic)       │
     │◄─────────────────────────────────────────────│
     │                                               │
     │  2. Noise XX Handshake (mutual auth)         │
     │◄════════════════════════════════════════════►│
     │     - Exchange Ed25519 public keys           │
     │     - Verify against whitelist               │
     │                                               │
     │  3. Capability Exchange                      │
     │◄────────────────────────────────────────────►│
     │     { "agent": "ci-bot", "version": "2.1",   │
     │       "accepts": ["review", "deploy"] }      │
     │                                               │
     │  4. Persistent Bidirectional Stream          │
     │◄════════════════════════════════════════════►│
     │     (kept alive with heartbeats)             │
     │                                               │
     │  5. Framed Messages                          │
     │◄────────────────────────────────────────────►│
     │     [length][type][payload][signature]       │
```

### 4.2 Message Frame Format

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        Length (32 bits)                       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|    Version    |     Type      |           Flags               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                      Timestamp (64 bits)                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
+                      Sender Public Key (32 bytes)             +
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
+                      Message Payload (variable)               +
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
+                      Ed25519 Signature (64 bytes)             +
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+

Types:
  0x01 = CONTROL (heartbeat, presence)
  0x02 = REQUEST (RPC-style request)
  0x03 = RESPONSE (RPC-style response)
  0x04 = EVENT (fire-and-forget)
  0x05 = STREAM_DATA (chunked data transfer)
  0x06 = STREAM_END (end of stream)

Flags:
  0x01 = ENCRYPTED (payload encrypted with ephemeral key)
  0x02 = COMPRESSED (payload compressed with zstd)
  0x04 = URGENT (priority queue bypass)
```

### 4.3 RPC Over Streams

Since connections are persistent, ARONIA uses request/response multiplexing:

```javascript
// Multiplexed RPC on single stream
const request = {
  id: randomUUID(),      // Request correlation ID
  method: 'review.pr',   // RPC method
  params: { pr: 42 },    // Parameters
  timeout: 30000         // Milliseconds to wait
}

// Response
const response = {
  id: request.id,        // Matches request
  result: { ... },       // Success data
  // OR
  error: { code, message } // Error details
}
```

**Benefits over HTTP:**
- No connection setup per request
- Bidirectional (server can push)
- Multiplexed (multiple requests in flight)
- Binary framing (no base64 overhead)

---

## 5. Failure Modes: The Realtime Trade-off

### 5.1 Network Partitions

**QUINCE handles this gracefully:** Messages queue, retry, eventually deliver.

**ARONIA must handle this explicitly:**

```
Partition Occurs:
┌──────────┐         X         ┌──────────┐
│  Alice   │◄───────X─────────►│   Bob    │
└──────────┘                   └──────────┘
     │                              │
     ▼                              ▼
 Connection drop detected     Connection drop detected
 (within 5-10 seconds)       (within 5-10 seconds)
     │                              │
     ▼                              ▼
 Application callback:        Application callback:
 onPeerOffline(Bob)           onPeerOffline(Alice)
     │                              │
     ▼                              ▼
 Options:                     Options:
 1. Retry connection          1. Retry connection
 2. Buffer locally            2. Accept unavailability
 3. Escalate to human         3. Degrade functionality
```

**Design Decision**: ARONIA provides the mechanism (detect partitions fast), application provides the policy (what to do about it).

### 5.2 Message Loss

**Scenario**: Alice sends to Bob, Bob disconnects mid-stream.

```
Alice ──► Stream.write(msg) ──► OS TCP Buffer
                                      │
                                      ▼
                              Bob's network drops
                                      │
                                      ▼
                              Alice gets ECONNRESET
                                      │
                                      ▼
                              Message is LOST (no ACK)
```

**Mitigation strategies:**

1. **Application-layer ACKs** (optional):
   ```javascript
   // Fire-and-forget (default)
   peer.send({ type: 'event', data })
   
   // Request-response (reliable)
   const response = await peer.request('process', data, { timeout: 5000 })
   ```

2. **Idempotency keys** (at-least-once at app layer):
   ```javascript
   peer.send({ 
     idempotencyKey: sha256(payload),
     data 
   })
   ```

3. **Hybrid mode** (best of both):
   - Realtime when connected
   - Spillover to persistent queue when partitioned
   - Automatic reconciliation on reconnection

### 5.3 Backpressure

**Problem**: Producer faster than consumer.

**QUINCE solution**: Disk-backed queue absorbs bursts.

**ARONIA solution**: Stream backpressure + bounded buffers.

```javascript
// Node.js streams handle this automatically
const stream = peer.createWriteStream()

// This will block when buffer full (app must handle)
stream.write(data) // Returns false if buffered

// Or use async iterator for flow control
for await (const data of produceData()) {
  await peer.send(data) // Waits for drain event
}
```

**Trade-off**: ARONIA sheds load immediately, QUINCE absorbs load durably.

---

## 6. Use Case Comparison

### 6.1 When to Use QUINCE (Store-and-Forward)

| Use Case | Why QUINCE Wins |
|----------|-----------------|
| **Async CI notifications** | Build completes at 2 AM, dev reads at 9 AM |
| **Review assignment** | Reviewer offline, gets notified later |
| **Audit logs** | Must not lose messages, durability > latency |
| **Cross-timezone teams** | Peers rarely online simultaneously |
| **Low-resource agents** | Can't maintain persistent connections |

### 6.2 When to Use ARONIA (Realtime)

| Use Case | Why ARONIA Wins |
|----------|-----------------|
| **Live collaboration** | Multiple agents editing shared state |
| **Request/response chains** | Agent A asks, Agent B must answer now |
| **Presence-aware routing** | "Send to any online deployment agent" |
| **Streaming data** | Logs, metrics, file transfers in progress |
| **Consensus protocols** | Raft, PBFT require realtime coordination |
| **Interactive debugging** | Human debugging live agent swarm |

### 6.3 Hybrid Architecture

Most real-world deployments need **both**:

```
┌─────────────────────────────────────────────────────────────┐
│                     Application Layer                        │
│  ┌─────────────────┐         ┌─────────────────┐           │
│  │   ARONIA Client │◄───────►│  QUINCE Client  │           │
│  │  (realtime)     │         │ (async)         │           │
│  └────────┬────────┘         └────────┬────────┘           │
│           │                           │                    │
│           └───────────┬───────────────┘                    │
│                       ▼                                    │
│              Routing Decision                              │
│         (critical path vs durability)                      │
└─────────────────────────────────────────────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
    ┌────────────┐    ┌────────────┐    ┌────────────┐
    │  ARONIA    │    │   Spillover│    │   QUINCE   │
    │  Realtime  │───►│   Queue    │◄───│  Async     │
    │  Mesh      │    │(persistent)│    │  Mail      │
    └────────────┘    └────────────┘    └────────────┘
```

**Routing logic:**
```javascript
function send(message) {
  if (message.priority === 'critical' && peer.isOnline()) {
    return aronia.send(peer, message) // Fast path
  } else {
    return quince.queue(peer, message) // Reliable path
  }
}
```

---

## 7. Implementation Roadmap

### Phase 1: Core Mesh (Weeks 1-4)

- [ ] Hyperswarm integration with Ed25519 authentication
- [ ] NoiseSecretStream wrapper with mutual whitelist
- [ ] Binary framing protocol
- [ ] Heartbeat/presence detection
- [ ] Basic request/response multiplexing

### Phase 2: Resilience (Weeks 5-8)

- [ ] Automatic reconnection with exponential backoff
- [ ] Connection pooling (multiple streams per peer)
- [ ] Backpressure handling and flow control
- [ ] Partition detection and callbacks
- [ ] Graceful degradation modes

### Phase 3: Features (Weeks 9-12)

- [ ] Topic-based multicast
- [ ] RPC method registry and reflection
- [ ] Stream multiplexing (multiple logical channels)
- [ ] Bandwidth shaping and QoS
- [ ] Metrics and observability

### Phase 4: Ecosystem (Weeks 13-16)

- [ ] WebSocket gateway for browser agents
- [ ] Language bindings (Python, Rust, Go)
- [ ] Integration with QUINCE (hybrid mode)
- [ ] Performance benchmarks vs QUICNE
- [ ] Security audit

---

## 8. Open Questions

1. **Storage spillover**: Should ARONIA nodes maintain a small local queue for "best effort" delivery during brief partitions? How large?

2. **Consensus integration**: Should ARONIA include primitives for Raft/PBFT (leader election, log replication), or stay transport-layer only?

3. **Browser support**: WebRTC data channels for browser-based agents, or WebSocket gateway to native nodes?

4. **Mobile agents**: Battery-conscious connection strategies (QUIC 0-RTT vs persistent TCP)?

5. **Discovery privacy**: Public DHT announces leak metadata. Private swarm bootstrap nodes?

6. **QUINCE compatibility**: Should ARONIA speak QUINCE protocol for fallback, or require separate deployment?

---

## 9. Appendix: Code Sketch

```typescript
// aronia/node.ts
import Hyperswarm from 'hyperswarm'
import { NoiseSecretStream } from '@hyperswarm/secret-stream'
import crypto from 'hypercore-crypto'

interface AroniaNodeOptions {
  keyPair: { publicKey: Buffer, secretKey: Buffer }
  whitelist: Set<string> // hex pubkeys
  topic: string
  heartbeatInterval: number // ms
}

class AroniaNode extends EventEmitter {
  private swarm: Hyperswarm
  private peers = new Map<string, PeerConnection>()
  private streams = new Map<string, MultiplexedStream>()
  
  constructor(private opts: AroniaNodeOptions) {
    super()
    this.swarm = new Hyperswarm({
      keyPair: opts.keyPair
    })
    
    this.swarm.on('connection', this.handleConnection.bind(this))
    this.swarm.join(crypto.hash(opts.topic), { 
      server: true, 
      client: true 
    })
  }
  
  private async handleConnection(rawSocket: any, info: any) {
    // Upgrade to encrypted stream with mutual auth
    const stream = new NoiseSecretStream(
      info.client, // are we the initiator?
      rawSocket,
      { 
        pattern: 'XX',
        staticKeyPair: this.opts.keyPair
      }
    )
    
    // Wait for handshake to complete
    await new Promise((resolve, reject) => {
      stream.on('handshake', resolve)
      stream.on('error', reject)
    })
    
    const remotePubkey = stream.remotePublicKey.toString('hex')
    
    // Enforce whitelist
    if (!this.opts.whitelist.has(remotePubkey)) {
      stream.destroy()
      this.emit('rejected', remotePubkey)
      return
    }
    
    // Wrap in multiplexed protocol handler
    const peer = new PeerConnection(stream, remotePubkey)
    this.peers.set(remotePubkey, peer)
    
    this.emit('peer:connected', { pubkey: remotePubkey, capabilities: peer.capabilities })
    
    // Handle disconnect
    stream.on('close', () => {
      this.peers.delete(remotePubkey)
      this.emit('peer:disconnected', remotePubkey)
    })
  }
  
  // Send to specific peer (fail if offline)
  async send(pubkey: string, message: Message): Promise<void> {
    const peer = this.peers.get(pubkey)
    if (!peer) {
      throw new PeerOfflineError(pubkey)
    }
    return peer.send(message)
  }
  
  // Request/response pattern
  async request(pubkey: string, method: string, params: any, timeout = 30000): Promise<any> {
    const peer = this.peers.get(pubkey)
    if (!peer) {
      throw new PeerOfflineError(pubkey)
    }
    return peer.request(method, params, timeout)
  }
  
  // Broadcast to all online peers
  broadcast(message: Message): { sent: number, offline: number } {
    let sent = 0
    let offline = 0
    
    for (const [pubkey, peer] of this.peers) {
      peer.send(message).then(() => sent++).catch(() => offline++)
    }
    
    return { sent, offline }
  }
  
  getOnlinePeers(): string[] {
    return Array.from(this.peers.keys())
  }
  
  async stop() {
    await this.swarm.destroy()
  }
}
```

---

## 10. Conclusion

ARONIA is not a replacement for QUINCE—it is a complementary approach for a different class of problems. Where QUINCE asks "how do I ensure this message is eventually received?", ARONIA asks "how do I communicate with my peers right now?"

The shift from store-and-forward to realtime is profound:

- **Latency**: Seconds → Milliseconds
- **Semantics**: At-least-once → At-most-once  
- **Model**: Mailbox → Continuous Presence
- **Failure**: Delayed → Immediate
- **State**: Disk-first → Memory-first

Hyperswarm makes this practical by solving the hard problems: decentralized discovery, NAT traversal, and encrypted streams. ARONIA builds the agent-specific protocol layer on top—authentication, multiplexing, backpressure, and failure handling.

The future of agent communication is not a single protocol, but a **continuum of options** from fire-and-forget UDP to persistent realtime streams to durable async queues. ARONIA fills the realtime gap, enabling the next generation of collaborative, stateful, and responsive agent systems.

---

*"In a swarm, no agent is an island."*
