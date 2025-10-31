const Transaction = require('./Transaction.js');
const WebSocket = require('ws');
const uuid = require('uuid');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const crypto = require('crypto');
const TransactionMerkle = require('./TransactionMerkle.js');

const minStake = 1000000000;
const fee = 100;
const fine = 10000;

const timestampRange = 60;
const maxVoteTime = 10000;

/**
 * SHA256 Hash function
 * @param {string} data 
 * @returns {string}
 */
function hash(data) {
    return crypto.createHash('sha256').update(data).digest().toString('hex');
}

/**
 * Peer to Peer class
 * @class
 */
class P2P {
    /**
     * Create new P2P server
     * @param {Object} chain
     * @param {number} port 
     * @param {Array<string>} peers 
     * @param {string} privateKey
     */
    constructor(chain, port, peers = [], privateKey) {
        this.chain = chain;
        this.port = port;
        this.peers = peers;
        this.sockets = [];
        this.validators = new Set();
        this.buf = [];
        this.consensus = {};
        this.vote = null;
        this.privateKey = privateKey;
        this.keyPair = ec.keyFromPrivate(privateKey, 'hex');
        this.publicKey = this.keyPair.getPublic('hex');
        this.transactionMerkle = new TransactionMerkle();
        this.pendingTxs = [];
    }

    /**
     * Starts the P2P server
     */
    start() {
        const server = new WebSocket.Server({ port: this.port });
        server.on('connection', (socket) => {
            this.connectSocket(socket);
        });

        const openPromises = this.peers.map(peer => {
            return new Promise(resolve => {
                const socket = new WebSocket(peer);
                socket.on('open', () => {
                    this.connectSocket(socket);
                    resolve();
                });
                socket.on('error', (err) => {
                    console.log(`connection error to ${peer}:`, err.code);
                    resolve();
                });
            });
        });


        Promise.all(openPromises).then(() => {
            this.reconnect(10);
            this.sockets.map(socket => {
                socket.on('close', () => {
                    this.reconnect(5);
                });
            })
            this.consensus = {};
            if (this.sockets.some(socket => socket.readyState === WebSocket.OPEN)) {
                console.log("receiving chain...");
                this.wantChain = true;
                this.send({ type: "GET_CHAIN" });
            } else {
                if (this.chain.transactions.length > 0 && Object.keys(this.chain.accounts).length == 0) {
                    console.log("creating accounts state...");
                    this.createAccState(this.chain.transactions);
                    console.log("done");
                } else {
                    console.log("creating merkle tree...");
                    let i = 0;
                    for (let transactionData of this.chain.transactions) {
                        const transaction = Transaction.deserialize(JSON.stringify(transactionData.transaction));
                        let valid = transaction.verify();
                        if (i < 6 && transaction.body == "GENESIS") valid = true;
                        if (!valid) {
                            console.log("transaction invalid: " + transaction.serialize());
                            continue;
                        };
                        
                        this.transactionMerkle.add(transaction.serialize());
                        i++;
                    }
                    console.log("done");
                }
            }
        });
    }

    /**
     * If no socket connections, server will be restart
     * @param {number} seconds 
     */
    reconnect(seconds) {
        if (!this.sockets.some(socket => socket.readyState === WebSocket.OPEN)) {
            console.log(`restarting in ${seconds} seconds`)
            setTimeout(() => {
                if (!this.sockets.some(socket => socket.readyState === WebSocket.OPEN)) {
                    console.log("restart");
                    process.exit(0);
                } else {
                    console.log("restart cancelled");
                }
            }, seconds*1000);
        }
    }

    connectSocket(socket) {
        this.sockets.push(socket);
        this.send({ type: "VALIDATOR", data: this.publicKey });
        this.msgHandler(socket);
        socket.on('close', () => {
            this.validators = new Set();
            this.send({ type: "VALIDATORS" });
        });
    }

    /**
     * Merkle root of transactions
     * @returns {string}
     */
    merkle() {
        return this.transactionMerkle.getRoot();
    }

    /**
     * Create accounts state in chain
     * @param {Array<Object>} transactions 
     */
    createAccState(transactions) {
        let i = 0;
        for (let transactionData of transactions) {
            const transaction = Transaction.deserialize(JSON.stringify(transactionData.transaction));
            let valid = this.transactionValid(transaction, false);
            if (i < 6 && transaction.body == "GENESIS") valid[0] = true;
            if (!valid[0]) {
                console.log("transaction invalid "+valid[1]+": " + transaction.serialize());
                continue;
            };

            if (!(transaction.from == "GENESIS" && i < 6)) {
                this.chain.accounts[transaction.from] = (this.chain.accounts[transaction.from] || { balance: 0, stake: 0, nonce: 0 });
                this.chain.accounts[transaction.from].balance -= transaction.amount;
            }

            if (transaction.to != "stake") {
                this.chain.accounts[transaction.to] = (this.chain.accounts[transaction.to] || { balance: 0, stake: 0, nonce: 0 });
                this.chain.accounts[transaction.to].balance += Math.floor(transaction.amount - fee);
            } else {
                this.chain.accounts[transaction.from].stake += Math.floor(transaction.amount - fee);
            }
            if (!(transaction.data == "GENESIS" && i < 6) && transactionData.validatorsRoot == hash(Object.keys(transactionData.validators).sort().join(':') + ":" + Object.values(transactionData.validators).sort().join(':'))) {
                for (let [validator, valid] of Object.entries(transactionData.validators)) {
                    if (valid == false)
                        this.chain.accounts[validator].stake -= fine;
                    else
                        this.chain.accounts[validator].balance += Math.floor(fee / Object.keys(transactionData.validators).length) + 1;
                }
                this.chain.accounts[transaction.from].nonce++;
            }
            this.transactionMerkle.add(transaction.serialize());
            
            i++;
        }
    }

    /**
     * Is transaction valid
     * @param {Transaction} transaction 
     * @param {boolean} now
     * @returns {boolean}
     */
    transactionValid(transaction, now) {
        try {
            let valid = transaction.verify();
            let reasons = [];
            if (transaction.timestamp > Math.floor(Date.now() / 1000) + timestampRange ||
                (now && transaction.timestamp < timestampRange + this.pendingTxs.length * (maxVoteTime / 1000)) ||
                transaction.amount < fee ||
                !this.chain.accounts[transaction.from] ||
                this.chain.accounts[transaction.from].balance < transaction.amount ||
                (now && transaction.nonce != this.chain.accounts[transaction.from].nonce)) valid = false;
            
            if (transaction.timestamp > Math.floor(Date.now() / 1000) + timestampRange) reasons.push('Transaction from future');
            if ((now && transaction.timestamp < timestampRange + this.pendingTxs.length * (maxVoteTime / 1000))) reasons.push('Timestamp has expired');
            if (transaction.amount < fee) reasons.push("Amount is lower than fee");
            if (!this.chain.accounts[transaction.from]) reasons.push("Invalid from");
            else if (this.chain.accounts[transaction.from].balance < transaction.amount) reasons.push(`Balance lower than amount (${this.chain.accounts[transaction.from].balance} < ${transaction.amount})`);
            if (now && transaction.nonce != this.chain.accounts[transaction.from].nonce) reasons.push("Invalid nonce");
            if (this.chain.transactions.length < 6 && transaction.body == "GENESIS") {
                reasons = [];
                valid = true;
            }
            return [valid, reasons];
        } catch (err) {
            console.log(err)
            return [false, [err]];
        }
    }

    getVoteTimeout() {
        const lastValidators = new Set([...this.validators]);
        this.voteTimeout = setTimeout(() => {
            for (let validator of [...lastValidators].filter(item => !Object.keys(this.consensus).includes(item))) {
                const socket = this.sockets.find(item => item.key === validator);
                if (socket) socket.close();
            }
            this.consensus = {};
            this.send({ type: "TRANSACTION", data: { transaction: this.vote.serialize(), valid: this.transactionValid(this.vote)[0], root: this.merkle() } }); // vote
            this.getVoteTimeout()
        }, maxVoteTime)
    }

    /**
     * Message handler
     * @param {WebSocket} socket 
     */
    msgHandler(socket) {
        socket.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                // МАГИЯ ПЕРЕСЫЛКИ ЕБАТЬ
                const nosign = JSON.parse(data);
                nosign.sign = undefined;
                if (!message.key || !message.sign || !message.id || this.buf.includes(message.id) || !(ec.keyFromPublic(message.key, 'hex').verify(hash(JSON.stringify(nosign)), message.sign))) return;
                this.buf.push(message.id);
                if (this.buf.length > 10) this.buf.shift();
                this.sockets.forEach(tsocket => {
                    if (tsocket.readyState === WebSocket.OPEN && tsocket != socket) {
                        let d = message;
                        tsocket.send(JSON.stringify(d));
                        //tsocket.send(data);
                    }
                });
                for (let i = 0; i < this.sockets.length; i++) {
                    if (this.sockets[i] == socket)
                        this.sockets[i].key = message.key;
                }


                const isValidator = !this.chain.accounts[message.key] || this.chain.accounts[message.key]?.stake < minStake;

                switch (message.type) {
                    case "GET_CHAIN":
                        this.send({ type: "CHAIN", data: { transactions: JSON.stringify(this.chain.transactions), root: this.merkle() }, for: message.key });
                        break;
                    case "CHAIN":
                        if (message.for != this.publicKey || !this.wantChain) {
                            break;
                        }
                        if (!this.consensus[message.key] && message.data.root && Object.keys(message.data.transactions).length >= Object.keys(this.chain).length)
                            this.consensus[message.key] = message.data;

                        if (Object.values(this.consensus).length >= this.validators.size - 1) {
                            const rootCount = new Map();
                            let maxRoot = '';

                            Object.values(this.consensus).forEach(({ root }) => {
                                const count = (rootCount.get(root) || 0) + 1;
                                rootCount.set(root, count);
                                if (count > (rootCount.get(maxRoot) || 0)) maxRoot = root;
                            });

                            const transactions = JSON.parse(Object.values(this.consensus).find(item => item.root === maxRoot)?.transactions);
                            if (transactions && transactions.length >= this.chain.transactions.length) {
                                this.chain.accounts = {};
                                this.wantChain = false;
                                this.chain.transactions = transactions;
                                console.log("chain synchronized: " + this.chain.transactions.length + " transactions");
                                if (this.chain.transactions.length == 0) break;
                                console.log("creating accounts state...");
                                this.createAccState(transactions);
                                console.log("done");
                            }
                        }
                        break;
                    case "VALIDATORS":
                        if (isValidator) {
                            break;
                        }
                        this.validators = new Set();
                        this.send({ type: "VALIDATOR", data: this.publicKey });
                        break;
                    case "VALIDATOR":
                        if (isValidator) {
                            break;
                        }
                        if (message.data !== this.publicKey) this.validators.add(message.data);
                        this.send({ type: "HELLO_VALIDATOR", data: this.publicKey });
                        break;
                    case "HELLO_VALIDATOR":
                        if (isValidator) {
                            break;
                        }
                        if (message.data !== this.publicKey) this.validators.add(message.data);
                        break;
                    case "NEW_TRANSACTION":
                        const transaction = Transaction.deserialize(message.data);
                        console.log(`new tx (${transaction.nonce}) valid: ${transaction.verify()}`);
                        if (this.vote) {
                            console.log(`adding ${transaction.nonce} to pending`)
                            this.pendingTxs.push(transaction);
                            break;
                        }

                        let valid = this.transactionValid(transaction, true)[0];
                        this.send({ type: "TRANSACTION", data: { transaction: transaction.serialize(), valid, root: this.merkle() } }); // vote
                        this.vote = transaction;
                        this.consensus = {};
                        this.getVoteTimeout();
                        break;
                    case "TRANSACTION":
                        if (!this.vote) break;
                        if (!message.data.root || this.merkle() != message.data.root || isValidator) {
                            console.log('fuck ', this.merkle(), message.data.root);
                            break;
                        }
                        if (!this.consensus[message.key] && this.vote.hash(false).toString('hex') == Transaction.deserialize(message.data.transaction).hash(false).toString('hex')) {
                            console.log("add vote: " + message.key.slice(0, 4))
                            this.consensus[message.key] = message.data;
                        }

                        const validators = Object.keys(this.consensus);
                        if (validators.length >= this.validators.size) {
                            const transaction = this.vote;
                            this.consensus[this.publicKey] = { transaction, valid: this.transactionValid(transaction)[0] };
                            const votes = Object.values(this.consensus).map(v => v.valid);
                            const result = votes.filter(v => v === true).length > votes.filter(v => v === false).length;
                            console.log("end vote: " + result);
                            if (result) {
                                if (!(transaction.from == "GENESIS" && this.chain.transactions.length < 6))
                                    this.chain.accounts[transaction.from].balance -= transaction.amount;
                                this.chain.accounts[transaction.from] = (this.chain.accounts[transaction.from] || { balance: 0, stake: 0, nonce: 0 });
                                if (transaction.to != "stake") {
                                    this.chain.accounts[transaction.to] = (this.chain.accounts[transaction.to] || { balance: 0, stake: 0, nonce: 0 });
                                    this.chain.accounts[transaction.to].balance += Math.floor(transaction.amount - fee);
                                } else {
                                    this.chain.accounts[transaction.from].stake += Math.floor(transaction.amount - fee);
                                }
                                if (!(transaction.data == "GENESIS" && this.chain.transactions.length < 6)) {
                                    validators.push(this.publicKey);
                                    for (let validator of validators) {
                                        if (!this.chain.accounts[validator]) continue;
                                        if (this.consensus[validator].valid != result)
                                            this.chain.accounts[validator].stake -= fine;
                                        else
                                            this.chain.accounts[validator].balance += Math.floor(fee / validators.length) + 1;
                                    }
                                    this.chain.accounts[transaction.from].nonce++;
                                }
                                const validatorsVotes = Object.fromEntries(Object.entries(this.consensus).map(([key, value]) => [key, value.valid]));

                                const historyTransaction = { transaction: JSON.parse(this.vote.serialize()), validators: validatorsVotes, validatorsRoot: hash(Object.keys(validatorsVotes).sort().join(':') + ":" + Object.values(validatorsVotes).sort().join(':')) };
                                this.chain.transactions.push(historyTransaction);
                                this.transactionMerkle.add(transaction.serialize());
                            } else {
                                console.log("reasons: "+this.transactionValid(transaction)[1])
                            }
                            this.vote = undefined;
                            if (this.voteTimeout)
                                this.voteTimeout.close();
                            if (this.pendingTxs.length > 0) {
                                const tx = this.pendingTxs.shift();
                                let valid = this.transactionValid(tx, true);
                                console.log(`pending tx (${tx.nonce}) valid: ${valid}`)
                                this.send({ type: "TRANSACTION", data: { transaction: tx.serialize(), valid, root: this.merkle() } }); // vote
                                this.vote = tx;
                                this.consensus = {};
                            }
                        }
                        break;
                }
            } catch (err) {
                console.log(err.message);
            }
        });
    }

    send(payload) {
        payload.id = uuid.v4();
        payload.key = this.publicKey;
        payload.sign = this.keyPair.sign(hash(JSON.stringify(payload))).toDER('hex');
        this.sockets.forEach(socket => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify(payload));
            }
        });
    }

    /**
     * Sends new transaction to network
     * @param {Transaction} transaction 
     */
    sendTransaction(transaction) {
        if (this.vote) {
            this.pendingTxs.push(transaction);
        } else {
            this.vote = transaction;
            this.consensus = {};
            this.getVoteTimeout();
        }
        this.send({ type: "NEW_TRANSACTION", data: transaction.serialize() });
    }
}

module.exports = P2P