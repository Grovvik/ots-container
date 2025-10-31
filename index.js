const P2P = require('./P2P.js');
const fs = require('fs');

const PORT = "4000"
const KEY = ""; // enter your private key
const PEERS = ""; // enter your peers

let chain = { transactions: [], accounts: {} };

const server = new P2P(chain, PORT, PEERS.split(','), KEY);
server.start()