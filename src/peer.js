// src/peer.js
// PeerConnection wrapper for encrypted streams (Bare-compatible)

import EventEmitter from 'bare-events';
import Buffer from 'bare-buffer';
import {
  MessageType,
  PeerOfflineError,
  RequestTimeoutError,
  ProtocolError,
} from './types.js';
import {
  serializeFrame,
  deserializeFrame,
  verifyFrame,
  createHeartbeat,
  createCapabilities,
  createRequest,
  createResponse,
} from './protocol.js';

export class PeerConnection extends EventEmitter {
  constructor(opts) {
    super();

    this.pubkey = opts.pubkey;
    this.stream = opts.stream;
    this.capabilities = {
      agent: "unknown",
      version: "0.0.0",
      accepts: [],
    };
    this.ourKeyPair = opts.ourKeyPair;
    this.heartbeatInterval = opts.heartbeatInterval ?? 30000;
    this.heartbeatTimeout = opts.heartbeatTimeout ?? 90000;
    this.connectedAt = Date.now();
    this.lastSeen = Date.now();
    this.online = true;

    this.pendingRequests = new Map();
    this.requestCounter = 0;
    this.destroyed = false;
    this.writeQueue = [];
    this.writeDraining = false;

    this.setupStreamHandlers();
    this.startHeartbeat();
    this.sendCapabilities();
  }

  setupStreamHandlers() {
    this.stream.on("data", (data) => {
      this.handleData(data);
    });

    this.stream.on("close", () => {
      this.handleDisconnect();
    });

    this.stream.on("error", (err) => {
      this.emit("error", err);
      this.handleDisconnect();
    });

    this.stream.on("drain", () => {
      this.processWriteQueue();
    });
  }

  handleData(data) {
    try {
      this.lastSeen = Date.now();
      this.resetHeartbeatTimeout();

      const frame = deserializeFrame(data);

      if (!verifyFrame(frame)) {
        this.emit("error", new ProtocolError("Invalid frame signature"));
        return;
      }

      const senderPubkeyHex = frame.senderPubkey.toString("hex");
      if (senderPubkeyHex !== this.pubkey) {
        this.emit(
          "error",
          new ProtocolError(
            `Sender mismatch: expected ${this.pubkey}, got ${senderPubkeyHex}`
          )
        );
        return;
      }

      this.handleFrame(frame);
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }

  handleFrame(frame) {
    const payload = JSON.parse(frame.payload.toString("utf-8"));

    switch (frame.type) {
      case MessageType.CONTROL:
        this.handleControl(payload);
        break;

      case MessageType.REQUEST:
        this.handleRequest(payload);
        break;

      case MessageType.RESPONSE:
        this.handleResponse(payload);
        break;

      case MessageType.EVENT:
        this.emit("message", { type: MessageType.EVENT, payload });
        break;

      case MessageType.INTRODUCE:
        this.emit("introduction", payload);
        break;

      default:
        this.emit("error", new ProtocolError(`Unknown message type: ${frame.type}`));
    }
  }

  handleControl(msg) {
    switch (msg.type) {
      case "heartbeat":
        break;

      case "capabilities":
        if (msg.data) {
          this.capabilities = msg.data;
          this.emit("capabilities", this.capabilities);
        }
        break;
    }
  }

  handleRequest(request) {
    this.emit("request", request, (response) => {
      this.sendResponse(response);
    });
  }

  handleResponse(response) {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(response.id);

    if (response.error) {
      pending.reject(new Error(response.error.message));
    } else {
      pending.resolve(response.result);
    }
  }

  handleDisconnect() {
    if (this.destroyed) return;

    this.online = false;
    this.stopHeartbeat();

    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new PeerOfflineError(this.pubkey));
    }
    this.pendingRequests.clear();

    this.emit("disconnect");
  }

  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.destroyed || !this.online) return;

      const heartbeat = createHeartbeat(this.ourKeyPair);
      this.writeFrame(heartbeat).catch(() => {});
    }, this.heartbeatInterval);

    this.resetHeartbeatTimeout();
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = undefined;
    }
  }

  resetHeartbeatTimeout() {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
    }

    this.heartbeatTimeoutTimer = setTimeout(() => {
      this.emit("timeout");
      this.destroy();
    }, this.heartbeatTimeout);
  }

  async writeFrame(frame) {
    if (this.destroyed) {
      throw new PeerOfflineError(this.pubkey);
    }

    const buffer = serializeFrame(frame);
    const canContinue = this.stream.write(buffer);

    if (!canContinue) {
      return new Promise((resolve, reject) => {
        this.writeQueue.push(buffer);

        const timeout = setTimeout(() => {
          reject(new Error("Write timeout due to backpressure"));
        }, 30000);

        const checkDrain = () => {
          if (!this.writeDraining) {
            clearTimeout(timeout);
            resolve();
          } else {
            setImmediate(checkDrain);
          }
        };

        checkDrain();
      });
    }
  }

  processWriteQueue() {
    this.writeDraining = false;

    while (this.writeQueue.length > 0 && !this.writeDraining) {
      const buffer = this.writeQueue.shift();
      this.writeDraining = !this.stream.write(buffer);
    }
  }

  async send(message) {
    const frame = createFrame(message.type, message.payload, this.ourKeyPair);
    await this.writeFrame(frame);
  }

  async request(method, params, timeout = 30000) {
    const id = `${Date.now()}-${++this.requestCounter}`;

    const request = {
      id,
      method,
      params,
      timeout,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new RequestTimeoutError(id, timeout));
      }, timeout);

      this.pendingRequests.set(id, {
        resolve,
        reject,
        timer,
      });

      const frame = createRequest(request, this.ourKeyPair);
      this.writeFrame(frame).catch((err) => {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err);
      });
    });
  }

  async sendResponse(response) {
    const frame = createResponse(response, this.ourKeyPair);
    await this.writeFrame(frame);
  }

  async sendCapabilities() {
    const ourCapabilities = {
      agent: "aronia",
      version: "0.1.0",
      accepts: ["application/json"],
    };

    const frame = createCapabilities(ourCapabilities, this.ourKeyPair);
    await this.writeFrame(frame);
  }

  destroy() {
    if (this.destroyed) return;

    this.destroyed = true;
    this.stopHeartbeat();
    this.stream.destroy();

    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new PeerOfflineError(this.pubkey));
    }
    this.pendingRequests.clear();
  }
}
