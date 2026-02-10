#!/usr/bin/env bare
// cli.js
// Command-line interface for ARONIA (Bare-compatible)

import crypto from 'hypercore-crypto';
import { AroniaNode } from './src/index.js';

const args = process.argv.slice(2);
const command = args[0];

function printUsage() {
  console.log(`
ARONIA - Realtime P2P Agent Communication

Usage:
  bare cli.js <command> [options]

Commands:
  start                    Start an ARONIA node
  identity                 Show your public key
  send <pubkey> <message>  Send a message to a peer
  peers                    List connected peers
  introduce <to> <target>  Introduce a peer to another
  trust <pubkey>           Auto-accept introductions from peer
  help                     Show this help

Examples:
  bare cli.js start --topic my-swarm
  bare cli.js send b8e1c4f2... '{"method":"ping"}'
  bare cli.js introduce <peer-pubkey> <new-peer-pubkey>
`);
}

async function main() {
  switch (command) {
    case 'start': {
      const topic = getArg('--topic') || 'aronia-default';
      const keyPair = crypto.keyPair();

      console.log(`
╔════════════════════════════════════════╗
║           ARONIA NODE STARTED          ║
╚════════════════════════════════════════╝

Public Key: ${keyPair.publicKey.toString('hex')}
Topic:      ${topic}

Your agent is now discoverable on the DHT.
Other agents can connect using your public key.
`);

      const node = new AroniaNode({
        keyPair,
        topic,
        whitelist: new Set(), // Start with empty whitelist
      });

      // Event handlers
      node.on('peer:connected', (info) => {
        console.log(`\n[+] Peer connected: ${info.pubkey.slice(0, 16)}...`);
        console.log(`    Agent: ${info.capabilities.agent} v${info.capabilities.version}`);
      });

      node.on('peer:disconnected', (pubkey) => {
        console.log(`\n[-] Peer disconnected: ${pubkey.slice(0, 16)}...`);
      });

      node.on('peer:rejected', (pubkey, reason) => {
        console.log(`\n[!] Peer rejected: ${pubkey.slice(0, 16)}... (${reason})`);
      });

      node.on('introduction:received', (intro) => {
        console.log(`\n[?] Introduction received for: ${intro.alias}`);
        console.log(`    Pubkey: ${intro.pubkey.slice(0, 16)}...`);
        console.log(`    From:   ${intro.introducerPubkey.slice(0, 16)}...`);
        console.log(`    Use 'bare cli.js accept-introduction ${intro.pubkey}' to accept`);
      });

      node.on('introduction:accepted', (pubkey, introducer) => {
        console.log(`\n[✓] Introduction accepted: ${pubkey.slice(0, 16)}...`);
        console.log(`    Introduced by: ${introducer.slice(0, 16)}...`);
      });

      // Graceful shutdown
      process.on('SIGINT', async () => {
        console.log('\n\nShutting down...');
        await node.stop();
        process.exit(0);
      });

      // Keep running
      await new Promise(() => {});
      break;
    }

    case 'identity': {
      const keyPair = crypto.keyPair();
      console.log('Public Key:', keyPair.publicKey.toString('hex'));
      break;
    }

    case 'send': {
      console.log('Send command requires a running node.');
      console.log("Use 'bare cli.js start' to start a node first.");
      break;
    }

    case 'peers': {
      console.log('Peers command requires a running node.');
      console.log("Use 'bare cli.js start' to start a node first.");
      break;
    }

    case 'introduce': {
      console.log('Introduce command requires a running node.');
      console.log("Use 'bare cli.js start' to start a node first.");
      break;
    }

    case 'trust': {
      const pubkey = args[1];
      if (!pubkey) {
        console.error('Error: Missing pubkey');
        console.log('Usage: bare cli.js trust <pubkey>');
        process.exit(1);
      }
      console.log(`Trust configuration for ${pubkey.slice(0, 16)}...`);
      console.log('(Requires running node)');
      break;
    }

    case 'help':
    default:
      printUsage();
  }
}

function getArg(name) {
  const index = args.indexOf(name);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return undefined;
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
