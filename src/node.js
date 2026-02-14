// src/node.js
// Core AroniaNode implementation with Hyperswarm integration (Bare-compatible)

import EventEmitter from 'bare-events';
import Hyperswarm from 'hyperswarm';
import crypto from 'hypercore-crypto';
import Buffer from 'bare-buffer';
import { PeerConnection } from './peer.js';
import {
  PeerOfflineError,
  AuthenticationError,
  IntroductionError,
  ProtocolError,
} from './types.js';
import {
  createIntroduction,
  validateIntroduction,
  detectCircularTrust,
} from './protocol.js';

export class AroniaNode extends EventEmitter {
  constructor(opts) {
    super();

    this.keyPair = opts.keyPair;
    this.whitelist = opts.whitelist ?? new Set();
    this.peers = new Map();
    this.pendingIntroductions = new Map();
    this.trustConfig = opts.trustConfig ?? {
      autoAcceptFrom: new Set(),
      maxTrustDepth: 3,
      requireApprovalFor: [],
    };
    this.introductionMaxAge = 24 * 60 * 60 * 1000;

    this.methods = new Map();
    this._stopping = false;

    this.heartbeatInterval = opts.heartbeatInterval ?? 30000;
    this.heartbeatTimeout = opts.heartbeatTimeout ?? 90000;
    this.reconnectMaxAttempts = opts.reconnectMaxAttempts ?? 10;
    this.reconnectBaseDelay = opts.reconnectBaseDelay ?? 1000;

    this.swarm = new Hyperswarm({
      keyPair: this.keyPair,
    });

    this.swarm.on("connection", this.handleConnection.bind(this));
    this.swarm.on("error", (err) => this.emit("error", err));

    this._topic = crypto.hash(Buffer.from(opts.topic));
    this._discovery = this.swarm.join(this._topic, { server: true, client: true });

    this.cleanupInterval = setInterval(() => {
      this.cleanupPendingIntroductions();
    }, 60000);

    this.registerBuiltInMethods();
  }

  async handleConnection(rawSocket, info) {
    if (this._stopping) return;

    try {
      const stream = rawSocket;

      // Hyperswarm only emits 'connection' after the Noise handshake completes,
      // so remotePublicKey is always available here. No need to wait for 'handshake'.
      const remotePubkey = stream.remotePublicKey;
      if (!remotePubkey) {
        throw new AuthenticationError("No remote public key in handshake");
      }

      const remotePubkeyHex = remotePubkey.toString("hex");

      if (!this.whitelist.has(remotePubkeyHex)) {
        stream.destroy();
        this.emit("peer:rejected", remotePubkeyHex, "Not in whitelist");
        return;
      }

      if (this.peers.has(remotePubkeyHex)) {
        const oldPeer = this.peers.get(remotePubkeyHex);
        oldPeer.destroy();
      }

      const peer = new PeerConnection({
        stream,
        pubkey: remotePubkeyHex,
        ourKeyPair: this.keyPair,
        heartbeatInterval: this.heartbeatInterval,
        heartbeatTimeout: this.heartbeatTimeout,
      });

      peer.on("capabilities", (caps) => {
        this.emit("peer:connected", {
          pubkey: remotePubkeyHex,
          capabilities: caps,
          connectedAt: peer.connectedAt,
          lastSeen: peer.lastSeen,
          online: true,
        });
      });

      peer.on("disconnect", () => {
        this.peers.delete(remotePubkeyHex);
        this.emit("peer:disconnected", remotePubkeyHex);
      });

      peer.on("request", (request, respond) => {
        this.handleRPCRequest(request, peer, respond);
      });

      peer.on("introduction", (intro) => {
        this.handleIntroduction(intro, remotePubkeyHex);
      });

      peer.on("error", (err) => {
        this.emit("error", err);
      });

      this.peers.set(remotePubkeyHex, peer);

      this.emit("peer:connected", {
        pubkey: remotePubkeyHex,
        capabilities: {
          agent: "unknown",
          version: "0.0.0",
          accepts: [],
        },
        connectedAt: peer.connectedAt,
        lastSeen: peer.lastSeen,
        online: true,
      });
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
      rawSocket.destroy();
    }
  }

  registerBuiltInMethods() {
    this.registerMethod("ping", async () => {
      return { pong: true, timestamp: Date.now() };
    });
  }

  async handleRPCRequest(request, peer, respond) {
    const handler = this.methods.get(request.method);

    if (!handler) {
      respond({
        id: request.id,
        error: {
          code: -32601,
          message: `Method not found: ${request.method}`,
        },
      });
      return;
    }

    try {
      const result = await handler(request.params, peer);
      respond({
        id: request.id,
        result,
      });
    } catch (err) {
      respond({
        id: request.id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  registerMethod(name, handler) {
    this.methods.set(name, handler);
  }

  async send(pubkey, message) {
    const peer = this.peers.get(pubkey);
    if (!peer || !peer.online) {
      throw new PeerOfflineError(pubkey);
    }
    return peer.send(message);
  }

  async request(pubkey, method, params, timeout) {
    const peer = this.peers.get(pubkey);
    if (!peer || !peer.online) {
      throw new PeerOfflineError(pubkey);
    }
    return peer.request(method, params, timeout);
  }

  broadcast(message) {
    let sent = 0;
    let offline = 0;

    for (const [pubkey, peer] of this.peers) {
      if (peer.online) {
        peer
          .send(message)
          .then(() => sent++)
          .catch(() => offline++);
      } else {
        offline++;
      }
    }

    return { sent, offline };
  }

  getOnlinePeers() {
    return Array.from(this.peers.keys()).filter((pubkey) =>
      this.peers.get(pubkey).online
    );
  }

  getPeerInfo(pubkey) {
    const peer = this.peers.get(pubkey);
    if (!peer) return undefined;

    return {
      pubkey,
      capabilities: peer.capabilities,
      connectedAt: peer.connectedAt,
      lastSeen: peer.lastSeen,
      online: peer.online,
    };
  }

  getAllPeers() {
    return Array.from(this.peers.values()).map((peer) => ({
      pubkey: peer.pubkey,
      capabilities: peer.capabilities,
      connectedAt: peer.connectedAt,
      lastSeen: peer.lastSeen,
      online: peer.online,
    }));
  }

  isPeerOnline(pubkey) {
    const peer = this.peers.get(pubkey);
    return peer ? peer.online : false;
  }

  addToWhitelist(pubkey) {
    this.whitelist.add(pubkey);
  }

  removeFromWhitelist(pubkey) {
    this.whitelist.delete(pubkey);
    const peer = this.peers.get(pubkey);
    if (peer) {
      peer.destroy();
    }
  }

  isWhitelisted(pubkey) {
    return this.whitelist.has(pubkey);
  }

  async introduce(peerPubkey, targetPubkey, alias, capabilities, message) {
    const peer = this.peers.get(peerPubkey);
    if (!peer || !peer.online) {
      throw new PeerOfflineError(peerPubkey);
    }

    const trustPath = [this.keyPair.publicKey.toString("hex")];

    const intro = {
      pubkey: targetPubkey,
      alias,
      capabilities,
      message,
      introducerPubkey: this.keyPair.publicKey.toString("hex"),
      timestamp: Date.now(),
      trustPath,
    };

    const frame = createIntroduction(intro, this.keyPair);
    await peer.send({ type: 0x07, payload: intro });
  }

  handleIntroduction(intro, introducerPubkeyHex) {
    try {
      const introducerPubkey = Buffer.from(introducerPubkeyHex, "hex");
      const validation = validateIntroduction(
        intro,
        introducerPubkey,
        this.introductionMaxAge
      );

      if (!validation.valid) {
        this.emit(
          "introduction:rejected",
          intro.pubkey,
          validation.error || "Validation failed"
        );
        return;
      }

      const ownPubkey = this.keyPair.publicKey.toString("hex");
      if (detectCircularTrust(intro.trustPath, ownPubkey)) {
        this.emit(
          "introduction:rejected",
          intro.pubkey,
          "Circular trust reference detected"
        );
        return;
      }

      if (intro.trustPath.length > this.trustConfig.maxTrustDepth) {
        this.emit(
          "introduction:rejected",
          intro.pubkey,
          `Trust chain too long (${intro.trustPath.length} > ${this.trustConfig.maxTrustDepth})`
        );
        return;
      }

      if (this.whitelist.has(intro.pubkey)) {
        this.emit("introduction:rejected", intro.pubkey, "Already whitelisted");
        return;
      }

      const pendingIntro = {
        ...intro,
        receivedAt: Date.now(),
      };
      this.pendingIntroductions.set(intro.pubkey, pendingIntro);

      if (this.shouldAutoAccept(intro)) {
        this.acceptIntroduction(intro.pubkey).catch((err) => {
          this.emit("error", err);
        });
      } else {
        this.emit("introduction:received", pendingIntro);
      }
    } catch (err) {
      this.emit(
        "introduction:rejected",
        intro.pubkey,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  shouldAutoAccept(intro) {
    const introducerPubkey = intro.introducerPubkey;

    if (!this.trustConfig.autoAcceptFrom.has(introducerPubkey)) {
      return false;
    }

    for (const cap of this.trustConfig.requireApprovalFor) {
      if (intro.capabilities.accepts.includes(cap)) {
        return false;
      }
    }

    return true;
  }

  async acceptIntroduction(pubkey) {
    const pending = this.pendingIntroductions.get(pubkey);
    if (!pending) {
      throw new IntroductionError(`No pending introduction for ${pubkey}`);
    }

    this.whitelist.add(pubkey);
    this.emit("introduction:accepted", pubkey, pending.introducerPubkey);
    this.pendingIntroductions.delete(pubkey);
  }

  async rejectIntroduction(pubkey) {
    const pending = this.pendingIntroductions.get(pubkey);
    if (!pending) {
      throw new IntroductionError(`No pending introduction for ${pubkey}`);
    }

    this.emit("introduction:rejected", pubkey, "Rejected by user");
    this.pendingIntroductions.delete(pubkey);
  }

  getPendingIntroductions() {
    return Array.from(this.pendingIntroductions.values());
  }

  cleanupPendingIntroductions() {
    const now = Date.now();
    const maxAge = this.introductionMaxAge;

    for (const [pubkey, intro] of this.pendingIntroductions) {
      if (now - intro.receivedAt > maxAge) {
        this.pendingIntroductions.delete(pubkey);
      }
    }
  }

  setTrust(pubkey, autoAccept) {
    if (autoAccept) {
      this.trustConfig.autoAcceptFrom.add(pubkey);
    } else {
      this.trustConfig.autoAcceptFrom.delete(pubkey);
    }
  }

  getTrust(pubkey) {
    return this.trustConfig.autoAcceptFrom.has(pubkey);
  }

  revokeTrust(pubkey, cascade = false) {
    this.trustConfig.autoAcceptFrom.delete(pubkey);

    if (cascade) {
      for (const [targetPubkey, peer] of this.peers) {
        this.removeFromWhitelist(targetPubkey);
      }
    }
  }

  async stop() {
    this._stopping = true;

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Leave the topic first to stop accepting new connections
    if (this._discovery) {
      await this._discovery.destroy();
    }

    for (const peer of this.peers.values()) {
      peer.destroy();
    }
    this.peers.clear();

    await this.swarm.destroy();
  }
}
