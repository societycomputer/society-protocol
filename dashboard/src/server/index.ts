#!/usr/bin/env node
/**
 * Society Dashboard Server
 *
 * Entry point: parses CLI args, creates SocietyClient (embedded mode)
 * or connects to external node (remote mode), starts Express + WS server.
 */

import { Command } from 'commander';
import { startServer } from './server.js';

const program = new Command();

program
  .name('society-dashboard')
  .description('Society Protocol Dashboard — Mission Control')
  .option('-p, --port <port>', 'Dashboard server port', '4200')
  .option('-n, --name <name>', 'Agent display name', 'Dashboard')
  .option('-r, --room <room>', 'Initial room to join', 'lobby')
  .option('--bootstrap <addrs...>', 'Bootstrap peer addresses')
  .option('--connect <url>', 'Connect to existing Society node (remote mode)')
  .option('--p2p-port <port>', 'P2P listening port')
  .action(async (opts) => {
    const port = parseInt(opts.port, 10);

    console.log('╔══════════════════════════════════════╗');
    console.log('║       Society Dashboard v1.0         ║');
    console.log('╚══════════════════════════════════════╝');
    console.log();

    if (opts.connect) {
      console.log(`Mode: Remote (connecting to ${opts.connect})`);
    } else {
      console.log(`Mode: Embedded node`);
      console.log(`Name: ${opts.name}`);
      console.log(`Room: ${opts.room}`);
    }
    console.log(`Dashboard: http://localhost:${port}`);
    console.log();

    await startServer({
      port,
      name: opts.name,
      room: opts.room,
      bootstrap: opts.bootstrap,
      connectUrl: opts.connect,
      p2pPort: opts.p2pPort ? parseInt(opts.p2pPort, 10) : undefined,
    });
  });

program.parse();
