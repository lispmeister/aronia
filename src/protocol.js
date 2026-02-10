// src/protocol.js
// Binary message framing and protocol utilities (Bare-compatible)

import Buffer from 'bare-buffer';
import crypto from 'hypercore-crypto';
import {
  MessageType,
  ProtocolError,
  PUBLIC_KEY_SIZE,
  SIGNATURE_SIZE,
  HEADER_SIZE,
  PROTOCOL_VERSION as PROTOCOL_VERSION_IMPORTED,
} from './types.js';

// Re-export protocol version for convenience
export const PROTOCOL_VERSION = PROTOCOL_VERSION_IMPORTED;

// ============================================================================
// Frame Serialization
// ============================================================================

export function serializeFrame(frame) {
  const totalSize =
    4 + // length (32 bits)
    1 + // version (8 bits)
    1 + // type (8 bits)
    2 + // flags (16 bits)
    8 + // timestamp (64 bits)
    PUBLIC_KEY_SIZE + // sender pubkey (32 bytes)
    frame.payload.length + // payload (variable)
    SIGNATURE_SIZE; // signature (64 bytes)

  const buffer = Buffer.alloc(totalSize);
  let offset = 0;

  // Length (32 bits, big-endian)
  buffer.writeUInt32BE(totalSize, offset);
  offset += 4;

  // Version (8 bits)
  buffer.writeUInt8(frame.version, offset);
  offset += 1;

  // Type (8 bits)
  buffer.writeUInt8(frame.type, offset);
  offset += 1;

  // Flags (16 bits)
  buffer.writeUInt16BE(frame.flags, offset);
  offset += 2;

  // Timestamp (64 bits, big-endian)
  buffer.writeBigUInt64BE(BigInt(frame.timestamp), offset);
  offset += 8;

  // Sender public key (32 bytes)
  frame.senderPubkey.copy(buffer, offset);
  offset += PUBLIC_KEY_SIZE;

  // Payload (variable)
  frame.payload.copy(buffer, offset);
  offset += frame.payload.length;

  // Signature (64 bytes)
  frame.signature.copy(buffer, offset);

  return buffer;
}

export function deserializeFrame(buffer) {
  if (buffer.length < HEADER_SIZE + SIGNATURE_SIZE) {
    throw new ProtocolError(
      `Buffer too small: ${buffer.length} bytes, need at least ${
        HEADER_SIZE + SIGNATURE_SIZE
      }`
    );
  }

  let offset = 0;

  // Length (32 bits)
  const length = buffer.readUInt32BE(offset);
  offset += 4;

  if (buffer.length !== length) {
    throw new ProtocolError(
      `Length mismatch: expected ${length}, got ${buffer.length}`
    );
  }

  // Version (8 bits)
  const version = buffer.readUInt8(offset);
  offset += 1;

  if (version !== PROTOCOL_VERSION) {
    throw new ProtocolError(`Unsupported protocol version: ${version}`);
  }

  // Type (8 bits)
  const type = buffer.readUInt8(offset);
  offset += 1;

  // Flags (16 bits)
  const flags = buffer.readUInt16BE(offset);
  offset += 2;

  // Timestamp (64 bits)
  const timestamp = Number(buffer.readBigUInt64BE(offset));
  offset += 8;

  // Sender public key (32 bytes)
  const senderPubkey = buffer.subarray(offset, offset + PUBLIC_KEY_SIZE);
  offset += PUBLIC_KEY_SIZE;

  // Payload (variable)
  const payloadLength = length - offset - SIGNATURE_SIZE;
  if (payloadLength < 0) {
    throw new ProtocolError("Invalid frame: negative payload length");
  }
  const payload = buffer.subarray(offset, offset + payloadLength);
  offset += payloadLength;

  // Signature (64 bytes)
  const signature = buffer.subarray(offset, offset + SIGNATURE_SIZE);

  return {
    length,
    version,
    type,
    flags,
    timestamp,
    senderPubkey,
    payload,
    signature,
  };
}

// ============================================================================
// Message Creation
// ============================================================================

export function createFrame(type, payload, keyPair, flags = 0) {
  const payloadBuffer = Buffer.from(JSON.stringify(payload));
  const timestamp = Date.now();

  const frameWithoutSig = {
    length: 0,
    version: PROTOCOL_VERSION,
    type,
    flags,
    timestamp,
    senderPubkey: keyPair.publicKey,
    payload: payloadBuffer,
    signature: Buffer.alloc(SIGNATURE_SIZE),
  };

  frameWithoutSig.length =
    4 + 1 + 1 + 2 + 8 + PUBLIC_KEY_SIZE + payloadBuffer.length + SIGNATURE_SIZE;

  const buffer = serializeFrame(frameWithoutSig);
  const dataToSign = buffer.subarray(0, buffer.length - SIGNATURE_SIZE);
  const signature = crypto.sign(dataToSign, keyPair.secretKey);

  return {
    ...frameWithoutSig,
    signature,
  };
}

export function verifyFrame(frame) {
  try {
    const frameCopy = {
      ...frame,
      signature: Buffer.alloc(SIGNATURE_SIZE),
    };
    const buffer = serializeFrame(frameCopy);
    const dataToVerify = buffer.subarray(0, buffer.length - SIGNATURE_SIZE);
    return crypto.verify(dataToVerify, frame.signature, frame.senderPubkey);
  } catch {
    return false;
  }
}

// ============================================================================
// Message Helpers
// ============================================================================

export function createHeartbeat(keyPair) {
  return createFrame(
    MessageType.CONTROL,
    { type: "heartbeat", timestamp: Date.now() },
    keyPair
  );
}

export function createCapabilities(capabilities, keyPair) {
  return createFrame(
    MessageType.CONTROL,
    { type: "capabilities", data: capabilities },
    keyPair
  );
}

export function createRequest(request, keyPair) {
  return createFrame(MessageType.REQUEST, request, keyPair);
}

export function createResponse(response, keyPair) {
  return createFrame(MessageType.RESPONSE, response, keyPair);
}

export function createEvent(event, keyPair) {
  return createFrame(MessageType.EVENT, event, keyPair);
}

export function createIntroduction(intro, keyPair) {
  const payloadBuffer = Buffer.from(JSON.stringify(intro));
  const signature = crypto.sign(payloadBuffer, keyPair.secretKey);

  const fullIntro = {
    ...intro,
    signature,
  };

  return createFrame(MessageType.INTRODUCE, fullIntro, keyPair);
}

// ============================================================================
// Validation
// ============================================================================

export function validateIntroduction(intro, introducerPubkey, maxAge = 24 * 60 * 60 * 1000) {
  const age = Date.now() - intro.timestamp;
  if (age > maxAge) {
    return { valid: false, error: `Introduction expired (${age}ms old)` };
  }

  if (age < 0) {
    return { valid: false, error: "Introduction from the future" };
  }

  const payload = {
    pubkey: intro.pubkey,
    alias: intro.alias,
    capabilities: intro.capabilities,
    message: intro.message,
    introducerPubkey: intro.introducerPubkey,
    timestamp: intro.timestamp,
    trustPath: intro.trustPath,
  };
  const payloadBuffer = Buffer.from(JSON.stringify(payload));

  if (!crypto.verify(payloadBuffer, intro.signature, introducerPubkey)) {
    return { valid: false, error: "Invalid introduction signature" };
  }

  if (intro.introducerPubkey !== introducerPubkey.toString('hex')) {
    return {
      valid: false,
      error: "Introducer pubkey mismatch in introduction",
    };
  }

  return { valid: true };
}

export function detectCircularTrust(trustPath, ownPubkey) {
  if (trustPath.includes(ownPubkey)) {
    return true;
  }

  const seen = new Set();
  for (const pubkey of trustPath) {
    if (seen.has(pubkey)) {
      return true;
    }
    seen.add(pubkey);
  }

  return false;
}
