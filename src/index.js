// src/index.js
// Main entry point for ARONIA (Bare-compatible)

export { AroniaNode } from './node.js';
export { PeerConnection } from './peer.js';
export * from './types.js';
export * from './protocol.js';

// Re-export crypto for key generation
export { default as crypto } from 'hypercore-crypto';
