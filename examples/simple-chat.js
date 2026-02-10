// examples/simple-chat.js
// Simple example of two agents communicating via ARONIA on Bare

import crypto from 'hypercore-crypto';
import { AroniaNode } from '../src/index.js';

async function main() {
  // Generate keypairs
  const aliceKeyPair = crypto.keyPair();
  const bobKeyPair = crypto.keyPair();

  console.log('🚀 Starting ARONIA on Bare Runtime\n');
  console.log('Alice:', aliceKeyPair.publicKey.toString('hex').slice(0, 16) + '...');
  console.log('Bob:  ', bobKeyPair.publicKey.toString('hex').slice(0, 16) + '...\n');

  const alicePubkey = aliceKeyPair.publicKey.toString('hex');
  const bobPubkey = bobKeyPair.publicKey.toString('hex');

  const alice = new AroniaNode({
    keyPair: aliceKeyPair,
    topic: 'aronia-demo-bare',
    whitelist: new Set([bobPubkey]),
    heartbeatInterval: 2000,
    heartbeatTimeout: 6000,
  });

  const bob = new AroniaNode({
    keyPair: bobKeyPair,
    topic: 'aronia-demo-bare',
    whitelist: new Set([alicePubkey]),
    heartbeatInterval: 2000,
    heartbeatTimeout: 6000,
  });

  // Event handlers
  alice.on('peer:connected', (info) => {
    console.log(`✅ Alice connected to ${info.pubkey.slice(0, 16)}...`);
  });

  bob.on('peer:connected', (info) => {
    console.log(`✅ Bob connected to ${info.pubkey.slice(0, 16)}...`);
  });

  // Bob registers methods
  bob.registerMethod('echo', async (params) => {
    console.log('📨 Bob received:', params);
    return { ...params, echoed: true, by: 'bob' };
  });

  bob.registerMethod('chat', async (params, peer) => {
    console.log(`💬 Bob received message from ${peer.pubkey.slice(0, 16)}:`, params.message);
    return { received: true, timestamp: Date.now() };
  });

  // Wait for connection
  console.log('⏳ Waiting for peers to connect via DHT...\n');

  await Promise.all([
    new Promise((resolve) => alice.once('peer:connected', resolve)),
    new Promise((resolve) => bob.once('peer:connected', resolve)),
  ]);

  await new Promise((resolve) => setTimeout(resolve, 500));

  console.log('\n📡 Sending RPC requests...\n');

  try {
    const echoResult = await alice.request(bobPubkey, 'echo', {
      message: 'Hello from Alice!',
    });
    console.log('✅ Echo result:', echoResult);

    const chatResult = await alice.request(bobPubkey, 'chat', {
      message: 'How are you, Bob?',
    });
    console.log('✅ Chat result:', chatResult);
  } catch (err) {
    console.error('❌ Error:', err.message);
  }

  // Demonstrate introductions
  console.log('\n🤝 Introduction Demo:');
  console.log('Alice will introduce Charlie to Bob...\n');

  const charlieKeyPair = crypto.keyPair();
  const charliePubkey = charlieKeyPair.publicKey.toString('hex');

  bob.on('introduction:received', (intro) => {
    console.log(`📨 Bob received introduction for: ${intro.alias}`);
    console.log(`   Pubkey: ${intro.pubkey.slice(0, 16)}...`);
    console.log(`   From:   ${intro.introducerPubkey.slice(0, 16)}...`);
    
    bob.acceptIntroduction(intro.pubkey).then(() => {
      console.log('✅ Bob accepted introduction\n');
    });
  });

  await alice.introduce(
    bobPubkey,
    charliePubkey,
    'charlie',
    { agent: 'charlie-bot', version: '1.0', accepts: ['chat'] },
    'Charlie is a new worker bot'
  );

  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log('\n📋 Final state:');
  console.log("Bob's whitelist:", Array.from(bob['whitelist']).map((k) => k.slice(0, 16) + '...'));
  console.log("Bob's pending intros:", bob.getPendingIntroductions().length);

  // Cleanup
  console.log('\n👋 Shutting down...');
  await alice.stop();
  await bob.stop();
  console.log('✅ Done!');
  
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
