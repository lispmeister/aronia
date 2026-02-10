// tests/protocol.test.js
// Unit tests for protocol layer (Bare-compatible with brittle)

import test from 'brittle';
import crypto from 'hypercore-crypto';
import Buffer from 'bare-buffer';
import {
  serializeFrame,
  deserializeFrame,
  createFrame,
  verifyFrame,
  createHeartbeat,
  createCapabilities,
  createRequest,
  createResponse,
  createEvent,
  createIntroduction,
  validateIntroduction,
  detectCircularTrust,
  PROTOCOL_VERSION,
} from '../src/protocol.js';
import { MessageType, ProtocolError } from '../src/types.js';

test('frame serialization and deserialization', (t) => {
  const keyPair = crypto.keyPair();
  const payload = Buffer.from(JSON.stringify({ test: 'data' }));
  const frame = {
    length: 100,
    version: PROTOCOL_VERSION,
    type: MessageType.EVENT,
    flags: 0,
    timestamp: Date.now(),
    senderPubkey: keyPair.publicKey,
    payload,
    signature: crypto.sign(payload, keyPair.secretKey),
  };

  const serialized = serializeFrame(frame);
  const deserialized = deserializeFrame(serialized);

  t.is(deserialized.version, frame.version);
  t.is(deserialized.type, frame.type);
  t.is(deserialized.flags, frame.flags);
  t.is(deserialized.timestamp, frame.timestamp);
  t.is(deserialized.senderPubkey.toString('hex'), frame.senderPubkey.toString('hex'));
  t.is(deserialized.payload.toString(), frame.payload.toString());
});

test('create and verify frame', (t) => {
  const keyPair = crypto.keyPair();
  const payload = { message: 'hello' };
  const frame = createFrame(MessageType.EVENT, payload, keyPair, 0);

  t.is(frame.version, PROTOCOL_VERSION);
  t.is(frame.type, MessageType.EVENT);
  t.ok(verifyFrame(frame));
});

test('reject frame with invalid signature', (t) => {
  const keyPair = crypto.keyPair();
  const payload = { message: 'hello' };
  const frame = createFrame(MessageType.EVENT, payload, keyPair);

  frame.signature[0] ^= 0xff;

  t.absent(verifyFrame(frame));
});

test('create heartbeat message', (t) => {
  const keyPair = crypto.keyPair();
  const frame = createHeartbeat(keyPair);

  t.is(frame.type, MessageType.CONTROL);
  t.ok(verifyFrame(frame));

  const payload = JSON.parse(frame.payload.toString());
  t.is(payload.type, 'heartbeat');
  t.ok(payload.timestamp);
});

test('create capabilities message', (t) => {
  const keyPair = crypto.keyPair();
  const caps = { agent: 'test', version: '1.0', accepts: ['json'] };
  const frame = createCapabilities(caps, keyPair);

  t.is(frame.type, MessageType.CONTROL);
  t.ok(verifyFrame(frame));

  const payload = JSON.parse(frame.payload.toString());
  t.is(payload.type, 'capabilities');
  t.alike(payload.data, caps);
});

test('create and validate introduction', (t) => {
  const keyPair = crypto.keyPair();
  const targetKeyPair = crypto.keyPair();

  const introData = {
    pubkey: targetKeyPair.publicKey.toString('hex'),
    alias: 'test-peer',
    capabilities: { agent: 'test', version: '1.0', accepts: ['json'] },
    message: 'Test introduction',
    introducerPubkey: keyPair.publicKey.toString('hex'),
    timestamp: Date.now(),
    trustPath: [keyPair.publicKey.toString('hex')],
  };

  const intro = {
    ...introData,
    signature: crypto.sign(
      Buffer.from(JSON.stringify(introData)),
      keyPair.secretKey
    ),
  };

  const result = validateIntroduction(intro, keyPair.publicKey);
  t.ok(result.valid);
});

test('reject expired introduction', (t) => {
  const keyPair = crypto.keyPair();
  const targetKeyPair = crypto.keyPair();

  const introData = {
    pubkey: targetKeyPair.publicKey.toString('hex'),
    alias: 'test-peer',
    capabilities: { agent: 'test', version: '1.0', accepts: ['json'] },
    message: 'Test',
    introducerPubkey: keyPair.publicKey.toString('hex'),
    timestamp: Date.now() - 25 * 60 * 60 * 1000,
    trustPath: [keyPair.publicKey.toString('hex')],
  };

  const intro = {
    ...introData,
    signature: crypto.sign(
      Buffer.from(JSON.stringify(introData)),
      keyPair.secretKey
    ),
  };

  const result = validateIntroduction(intro, keyPair.publicKey);
  t.absent(result.valid);
  t.ok(result.error.includes('expired'));
});

test('detect circular trust', (t) => {
  const ownPubkey = 'aaa';
  const trustPath = ['bbb', 'ccc', 'aaa'];

  t.ok(detectCircularTrust(trustPath, ownPubkey));
});

test('detect duplicate pubkeys in chain', (t) => {
  const ownPubkey = 'zzz';
  const trustPath = ['bbb', 'ccc', 'bbb'];

  t.ok(detectCircularTrust(trustPath, ownPubkey));
});

test('accept valid trust chain', (t) => {
  const ownPubkey = 'zzz';
  const trustPath = ['aaa', 'bbb', 'ccc'];

  t.absent(detectCircularTrust(trustPath, ownPubkey));
});
