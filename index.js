const P2P = require('./P2P.js');
const fs = require('fs');

const PORT = "4000"
const KEY = process.env.KEY;
const PEERS = process.env.PEERS;

let chain = { transactions: [], accounts: {} };

const server = new P2P(chain, PORT, PEERS.split(','), KEY);
server.start()
