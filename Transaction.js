const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const crypto = require('crypto')

/**
 * Transaction class
 * @class
 */
class Transaction {
    /**
     * Create a new transaction
     * @param {string} from 
     * @param {string} to 
     * @param {number} amount 
     * @param {string} body 
     * @param {number} nonce
     */
    constructor(from, to, amount, body, nonce) {
        this.from = from;
        this.to = to;
        this.amount = amount;
        this.body = body;
        this.nonce = nonce;
        this.timestamp = Math.floor(Date.now()/1000);
    }

    /**
     * Serializes the transaction to JSON string
     * @param {boolean} nosign
     * @returns {string}
     */
    serialize(nosign=false) {
        if (!nosign && this.signature) {
            return JSON.stringify({
                from: this.from,
                to: this.to,
                amount: this.amount,
                timestamp: this.timestamp,
                nonce: this.nonce,
                body: this.body,
                signature: this.signature
            });
        }
        return JSON.stringify({
            from: this.from,
            to: this.to,
            amount: this.amount,
            timestamp: this.timestamp,
            nonce: this.nonce,
            body: this.body
        });
    }
    
    /**
     * Deserializes the transaction from JSON
     * @param {string} data 
     * @returns {Transaction} 
     */
    static deserialize(data) {
        const json = JSON.parse(data);
        const transaction = new this(json.from, json.to, json.amount, json.body, json.nonce);
        transaction.signature = json.signature;
        transaction.timestamp = json.timestamp;
        return transaction
    }

    /**
     * Signs the transaction
     * @param {string} privateKey 
     */
    sign(privateKey) {
        const keyPair = ec.keyFromPrivate(privateKey, 'hex');
        if (keyPair.getPublic('hex') != this.from) throw new Error("Invalid private key");
        const hash = this.hash();
        this.signature = keyPair.sign(hash).toDER('hex');
    }

    /** 
     * Verifies the transaction by signature
     * @returns {boolean}
    */
    verify() {
        if (!this.signature || !this.from) return false;
        const keyPair = ec.keyFromPublic(this.from, 'hex');
        if (keyPair.getPublic('hex') != this.from) throw new Error("Invalid private key")
        const hash = this.hash();
        return keyPair.verify(hash, this.signature);
    }

    /**
     * SHA256 Hash of transaction
     * @param {boolean} nosign
     * @returns {Buffer}
     */
    hash(nosign=true) {
        return crypto.createHash('sha256').update(this.serialize(nosign)).digest();
    }
}

module.exports = Transaction