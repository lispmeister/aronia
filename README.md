# ARONIA

> *Realtime P2P agent communication. No servers. No queues. Just presence.*

**ARONIA** is a realtime mesh network for AI agents built on the [Bare runtime](https://bare.pears.com/). While traditional systems treat agent communication as store-and-forward (like email), ARONIA treats it as persistent, bidirectional streams with sub-100ms latency.

```
Traditional:  "I'll queue this and retry later"  →  Latency: seconds to hours
ARONIA:       "Are they online? Send now."       →  Latency: <100ms
```

## Why Bare?

[Bare](https://bare.pears.com/) is a minimal JavaScript runtime built by Holepunch (the creators of Hyperswarm). It's designed specifically for peer-to-peer applications.

**Advantages:**
- **Native P2P Support** - Built by the same team as Hyperswarm
- **Minimal Footprint** - Smaller than Node.js or Bun
- **Mobile Ready** - Runs on iOS and Android
- **Perfect Integration** - Hyperswarm works flawlessly out-of-the-box

## Quick Start

### Installation

```bash
# Install Bare runtime globally
npm install -g bare

# Clone and setup
git clone <repo-url>
cd aronia
npm install

# Run tests (10/10 passing)
bare tests/protocol.test.js

# Run example
bare examples/simple-chat.js
```

### Your First Agent

```javascript
// my-agent.js
import crypto from 'hypercore-crypto';
import { AroniaNode } from './src/index.js';

// Generate a unique identity
const keyPair = crypto.keyPair();
console.log('My pubkey:', keyPair.publicKey.toString('hex'));

// Create your agent
const node = new AroniaNode({
  keyPair,
  topic: 'my-agent-swarm',
  whitelist: new Set() // Start empty, add peers as you meet them
});

// Handle connections
node.on('peer:connected', (info) => {
  console.log('Connected to:', info.pubkey.slice(0, 16) + '...');
  console.log('Agent type:', info.capabilities.agent);
});

// Register a method others can call
node.registerMethod('ping', async () => {
  return { pong: true, timestamp: Date.now() };
});

// Keep running
console.log('Agent running... Press Ctrl+C to exit');

// Graceful shutdown
process.on('SIGINT', async () => {
  await node.stop();
  process.exit(0);
});
```

Run it:
```bash
bare my-agent.js
```

## Core Features

**🚀 Sub-100ms Latency**
- Persistent encrypted streams (no connection setup per message)
- No HTTP overhead
- Direct P2P connections

**👁️ Presence Awareness**
- Know who's online *right now*
- Automatic discovery via DHT (BitTorrent technology)
- Heartbeat mechanism (30s interval, 90s timeout)

**🕸️ Self-Healing Mesh**
- NAT traversal (works through 85-95% of firewalls)
- Auto-reconnection with exponential backoff
- No single point of failure

**🤝 Trust Networks**
- **Introductions:** Trusted peers vouch for newcomers
- **Transitive Trust:** Auto-accept from designated introducers
- **Cryptographic Verification:** Ed25519 signatures on all messages

**🔒 Security**
- Ed25519 identity keys
- Noise protocol encryption (XChaCha20-Poly1305)
- Mutual authentication via whitelist
- Every message cryptographically signed

## Architecture

```
┌─────────┐   Persistent   ┌─────────┐   DHT Discovery   ┌─────────┐
│  Agent  │◄──────────────►│ ARONIA  │◄─────────────────►│ ARONIA  │
│  (Any)  │   Encrypted    │  Node   │   Swarm Topics    │  Node   │
│         │   P2P Stream   │         │                   │         │
└─────────┘                └────┬────┘                   └────┬────┘
                                │                             │
                                ▼                             ▼
                          ┌───────────┐                 ┌───────────┐
                          │  Stream   │◄───────────────►│  Stream   │
                          │ (Noise    │                 │ (Noise    │
                          │ Protocol) │                 │ Protocol) │
                          └───────────┘                 └───────────┘
```

**Stack:**
- **Bare Runtime** - Minimal JavaScript engine
- **Hyperswarm** - DHT peer discovery and NAT traversal
- **NoiseSecretStream** - Encrypted, authenticated channels
- **Binary Protocol** - Framed messages with Ed25519 signatures

## Usage Guide

### Creating a Node

```javascript
import crypto from 'hypercore-crypto';
import { AroniaNode } from './src/index.js';

const keyPair = crypto.keyPair();

const node = new AroniaNode({
  keyPair,
  topic: 'production-agents',
  whitelist: new Set([
    'b8e1c4f2...',  // Alice's pubkey
    'a3f7b2d9...'   // Bob's pubkey
  ]),
  heartbeatInterval: 30000,  // 30 seconds
  heartbeatTimeout: 90000,   // 90 seconds
  trustConfig: {
    autoAcceptFrom: new Set(['b8e1c4f2...']),  // Trust Alice's intros
    maxTrustDepth: 3,                          // Max 3 hops
    requireApprovalFor: ['admin']              // Manual approval for admin
  }
});
```

### Handling Connections

```javascript
node.on('peer:connected', (info) => {
  console.log('✅ Connected:', info.pubkey.slice(0, 16));
  console.log('   Agent:', info.capabilities.agent);
  console.log('   Version:', info.capabilities.version);
});

node.on('peer:disconnected', (pubkey) => {
  console.log('❌ Disconnected:', pubkey.slice(0, 16));
});

node.on('peer:rejected', (pubkey, reason) => {
  console.log('🚫 Rejected:', pubkey.slice(0, 16), '-', reason);
});
```

### Sending Messages

**Fire-and-forget events:**
```javascript
await node.send(peerPubkey, {
  type: 0x04, // EVENT
  payload: {
    action: 'deploy',
    env: 'staging',
    commit: 'abc123'
  }
});

// Broadcast to all online peers
const { sent, offline } = node.broadcast({
  type: 0x04,
  payload: { alert: 'system maintenance in 5min' }
});
```

**RPC (request/response):**
```javascript
const result = await node.request(
  peerPubkey,
  'deploy',
  { env: 'staging' },
  30000  // 30 second timeout
);
```

### Registering RPC Methods

```javascript
node.registerMethod('deploy', async (params, peer) => {
  console.log(`Deploy from ${peer.pubkey.slice(0, 16)}`);
  
  const deploymentId = await deployToEnvironment(params.env);
  
  return {
    success: true,
    deploymentId,
    timestamp: Date.now()
  };
});

node.registerMethod('status', async () => ({
  status: 'healthy',
  uptime: process.uptime(),
  memory: process.memoryUsage()
}));
```

### Trust Network (Introductions)

Introductions solve the "how do I add 100 peers" problem:

```javascript
// Alice (coordinator) introduces Charlie to Bob
await alice.introduce(
  bobPubkey,                                    // Tell Bob
  charliePubkey,                                // About Charlie
  'charlie-worker-3',                           // Alias
  {                                             // Capabilities
    agent: 'worker',
    version: '2.1',
    accepts: ['task', 'ping']
  },
  'Charlie handles image processing'           // Context
);
```

**Bob receives and accepts:**
```javascript
bob.on('introduction:received', (intro) => {
  console.log(`Introduction for ${intro.alias} from ${intro.introducerPubkey.slice(0, 16)}`);
  
  if (intro.capabilities.accepts.includes('admin')) {
    console.log('Requires manual approval');
  } else {
    bob.acceptIntroduction(intro.pubkey);
  }
});

bob.on('introduction:accepted', (pubkey, introducer) => {
  console.log(`✅ Now connected to ${pubkey.slice(0, 16)}`);
});
```

**Configure auto-accept:**
```javascript
// Auto-accept introductions from Alice
node.setTrust(alicePubkey, true);
```

### Querying State

```javascript
// Get online peers
const onlinePeers = node.getOnlinePeers();

// Get peer info
const peerInfo = node.getPeerInfo(peerPubkey);

// Check if online
if (node.isPeerOnline(peerPubkey)) {
  await node.send(peerPubkey, message);
}

// List pending introductions
const pending = node.getPendingIntroductions();
```

### Error Handling

```javascript
import { PeerOfflineError, RequestTimeoutError } from './src/index.js';

try {
  await node.request(offlinePeerPubkey, 'method', params);
} catch (err) {
  if (err instanceof PeerOfflineError) {
    console.log('Peer offline');
  } else if (err instanceof RequestTimeoutError) {
    console.log('Request timed out');
  }
}

// Global error handler
node.on('error', (err) => {
  console.error('Node error:', err);
});
```

## Project Structure

```
aronia/
├── src/
│   ├── index.js         # Main exports
│   ├── node.js          # AroniaNode class (450 lines)
│   ├── peer.js          # PeerConnection class (320 lines)
│   ├── protocol.js      # Binary protocol (280 lines)
│   └── types.js         # Constants and errors
├── tests/
│   └── protocol.test.js # Unit tests (brittle framework)
├── examples/
│   └── simple-chat.js   # Demo application
├── cli.js               # Command-line tool
└── package.json
```

**Total: ~1,200 lines of JavaScript**

## API Reference

### Constructor Options

```javascript
const node = new AroniaNode({
  keyPair: { publicKey, secretKey },  // Required: Ed25519 keypair
  topic: 'my-topic',                   // Required: DHT topic
  whitelist: new Set(),                // Optional: Allowed pubkeys
  heartbeatInterval: 30000,            // Optional: ms (default: 30000)
  heartbeatTimeout: 90000,             // Optional: ms (default: 90000)
  trustConfig: {                       // Optional
    autoAcceptFrom: new Set(),         // Auto-accept intros from
    maxTrustDepth: 3,                  // Max trust chain depth
    requireApprovalFor: []             // Capabilities requiring approval
  }
});
```

### Methods

| Method | Description |
|--------|-------------|
| `send(pubkey, message)` | Send fire-and-forget message |
| `request(pubkey, method, params, timeout)` | RPC request |
| `broadcast(message)` | Send to all online peers |
| `registerMethod(name, handler)` | Register RPC handler |
| `introduce(peerPubkey, targetPubkey, alias, capabilities, message)` | Introduce peer |
| `acceptIntroduction(pubkey)` | Accept pending introduction |
| `rejectIntroduction(pubkey)` | Reject pending introduction |
| `setTrust(pubkey, autoAccept)` | Configure auto-accept |
| `getOnlinePeers()` | Get array of online pubkeys |
| `getPeerInfo(pubkey)` | Get detailed peer info |
| `getAllPeers()` | Get all peers |
| `isPeerOnline(pubkey)` | Check if peer is online |
| `getPendingIntroductions()` | Get pending introductions |
| `stop()` | Graceful shutdown |

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `peer:connected` | `{ pubkey, capabilities, connectedAt, lastSeen, online }` | Peer connected |
| `peer:disconnected` | `pubkey` | Peer disconnected |
| `peer:rejected` | `pubkey, reason` | Peer rejected |
| `introduction:received` | `Introduction` | New introduction |
| `introduction:accepted` | `pubkey, introducer` | Introduction accepted |
| `introduction:rejected` | `pubkey, reason` | Introduction rejected |
| `error` | `Error` | Node error |

## Scripts

```bash
# Run tests
bare tests/protocol.test.js
npm test

# Run example
bare examples/simple-chat.js
npm run example

# Start CLI
bare cli.js start --topic my-swarm
npm start
```

## Development

### Testing with Brittle

Tests use the [brittle](https://github.com/mafintosh/brittle) TAP framework:

```javascript
import test from 'brittle';

test('description', (t) => {
  t.is(actual, expected);
  t.ok(value);
  t.absent(value);
  t.alike(actual, expected); // deep equal
});
```

### Running Tests

```bash
# All tests
bare tests/protocol.test.js

# Output:
# TAP version 13
# # frame serialization
# ok 1 - should be equal
# ...
# 1..10
# # tests = 10/10 pass
# # asserts = 24/24 pass
```

## Use Cases

### 🤖 Agent Swarms

```javascript
// Coordinator introduces workers as they come online
for (const worker of newWorkers) {
  for (const peer of node.getAllPeers()) {
    await node.introduce(
      peer.pubkey,
      worker.pubkey,
      worker.alias,
      worker.capabilities
    );
  }
}
```

### 🔄 Consensus Protocols

```javascript
// Leader election
const votes = await Promise.all(
  peers.map(p => 
    node.request(p, 'vote', { term: newTerm })
      .catch(() => null)
  )
);
```

### 📊 Streaming Data

```javascript
node.registerMethod('metrics', async function* () {
  for await (const metric of getMetricsStream()) {
    yield metric;
  }
});
```

## Comparison

| Feature | Traditional (HTTP/WebSockets) | ARONIA |
|---------|------------------------------|--------|
| Infrastructure | Servers, load balancers | None |
| Latency | 50-500ms + connection setup | <100ms (persistent) |
| Discovery | DNS, service registry | DHT (automatic) |
| Offline Handling | Retry logic | Fail fast |
| Scale | Vertical + horizontal | Horizontal (mesh) |
| Trust | TLS certificates | Ed25519 + whitelist |

## License

MIT

---

*In a swarm, no agent is an island.*
