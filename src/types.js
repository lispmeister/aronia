// src/types.js
// Type definitions and constants for ARONIA protocol (Bare-compatible)

// Message Types
export const MessageType = {
  CONTROL: 0x01,
  REQUEST: 0x02,
  RESPONSE: 0x03,
  EVENT: 0x04,
  STREAM_DATA: 0x05,
  STREAM_END: 0x06,
  INTRODUCE: 0x07,
};

// Message Flags
export const MessageFlags = {
  ENCRYPTED: 0x01,
  COMPRESSED: 0x02,
  URGENT: 0x04,
};

// Protocol constants
export const PROTOCOL_VERSION = 1;
export const HEADER_SIZE = 52;
export const SIGNATURE_SIZE = 64;
export const PUBLIC_KEY_SIZE = 32;

// Error Classes
export class AroniaError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class PeerOfflineError extends AroniaError {
  constructor(pubkey) {
    super(`Peer ${pubkey} is offline`);
  }
}

export class RequestTimeoutError extends AroniaError {
  constructor(requestId, timeout) {
    super(`Request ${requestId} timed out after ${timeout}ms`);
  }
}

export class AuthenticationError extends AroniaError {
  constructor(message) {
    super(`Authentication failed: ${message}`);
  }
}

export class ProtocolError extends AroniaError {
  constructor(message) {
    super(`Protocol error: ${message}`);
  }
}

export class IntroductionError extends AroniaError {
  constructor(message) {
    super(`Introduction failed: ${message}`);
  }
}
