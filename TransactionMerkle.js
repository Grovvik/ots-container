const crypto = require('crypto');
const Transaction = require('./Transaction.js');

function hash(data) {
    return crypto.createHash('sha256').update(data.toString()).digest('hex');
}

class TransactionMerkle {
    /**
     * Create new Transaction merkle tree
     */
    constructor() {
        this.leaves = [];
        this.levels = [[]];
    }

    /**
     * Add transaction to merkle tree
     * @param {Transaction} transaction 
     */
    add(transaction) {
        try {
            if (!transaction.hash)
                transaction = Transaction.deserialize(transaction);
            const leafHash = transaction.hash(false).toString('hex');
            this.leaves.push(leafHash);
            let level = 0;
            let nodes = this.levels[level];
            nodes.push(leafHash);

            while (nodes.length % 2 === 0 && nodes.length > 0) {
                level++;
                if (!this.levels[level]) {
                    this.levels[level] = [];
                }

                this.levels[level - 1] = this.levels[level - 1].slice(0, -2);
                this.levels[level].push(hash(nodes[nodes.length - 2] + nodes[nodes.length - 1]));

                nodes = this.levels[level];
            }
        } catch(err) {
            console.error(err)
        }
    }

    /**
     * Get merkle root
     * @returns {string}
     */
    getRoot() {
        if (this.leaves.length === 0) {
            return hash('0');
        }

        let nodes = [...this.levels[this.levels.length - 1]];

        while (nodes.length > 1) {
            const next = [];
            for (let i = 0; i < nodes.length; i += 2) {
                next.push(hash(nodes[i] + i + 1 < nodes.length ? nodes[i + 1] : nodes[i]));
            }
            nodes = next;
        }

        return nodes[0];
    }
    /**
     * Get size of leaves of merkle tree
     * @returns {number}
     */
    size() {
        return this.leaves.length;
    }
    /**
     * Get leaves of merkle tree
     * @returns {Array<Array>}
     */
    getLeaves() {
        return [...this.leaves];
    }
}

module.exports = TransactionMerkle;