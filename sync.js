const fs = require('fs/promises');
const ethers = require("ethers");

const abi = require("./abi.json");
const kolList = require("./kolList.json");

const {
    getLevelFromCommand,
    formatAddress,
    getTierFromNodePrice,
    logGeneral,
    logPageCodeType,
    logReferralsListByLevel,
    logReferralsListByLevelNsb,
    logTier,
} = require('./utils');

const {
    CONTRACT_ADDRESS,
    RPC,
    ADMIN_IDS,
    REF_CODES,
    TIERS
} = require('./constants');

const provider = new ethers.providers.JsonRpcProvider(RPC);

class Node {
    constructor(address) {
        this.address = address;
        this.children = [];
    }
}

class Tree {
    constructor(root) {
        this.root = root;
        this.levelMap = new Map();
        this.refCountMap = new Map();
        this.txNodesBuyMap = new Map();
        this.saleMap = new Map();
        this.currentTier = 1;
    }

    async preorderTraversal(node = this.root, level = 1, maxLevel = 10) {
        if (node) {
            await this.getNewNodeEvents(node.address, level);
            level++;
            if (level <= maxLevel) {
                let searchNode = this.search(node.address);
                for (const child of searchNode.children) {
                    await this.preorderTraversal(child, level);
                }
            }
        }
    }

    preOrderInsert(parent, child) {
        if (!parent) {
            throw new Error("Parent node cannot be null");
        }
        if (parent.address != child.address) {
            parent.children.unshift(child); // Insert child at the beginning for pre-order
            child.children.forEach(grandchild => this.preOrderInsert(child, grandchild));
        }
    }

    search(address) {
        const queue = [this.root];
        while (queue.length) {
            const node = queue.shift();
            if (node.address == address) {
                return node;
            }
            queue.push(...node.children);
        }
        return null;
    }

    async getNewNodeEvents(inputAddress, level) {
        let parent = this.search(inputAddress);
        try {
            // Create a contract instance
            const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);

            // get current tier
            const state = await contract._state();
            const nodePrice = state['_nodePrice'];
            const price = parseFloat(ethers.utils.formatUnits(nodePrice).toString());
            this.currentTier = getTierFromNodePrice(price);

            const filter = {
                address: CONTRACT_ADDRESS,
                topics: [
                    "0x448511bdc0685b88ba7db67a898512cd63b1a760d8beef3e3d10974907845333",
                    null, // _owner
                    null, // _nodePrice
                    ethers.utils.hexZeroPad(inputAddress, 32), // _refAddress
                ]
            }

            const events = await contract.queryFilter(filter);

            const ownersSet = new Set();
            const txHashes = [];
            let numberNodeSold = 0;
            // let totalETH = ethers.BigNumber.from('0');
            for (const event of events) {
                const args = event.args;
                const txHash = event.transactionHash;
                txHashes.push(txHash);
                const owner = args['_owner'];
                const numberOfNodes = args['_numberOfNodes'].toNumber();

                let tx = await provider.getTransaction(txHash);
                let txValue = parseFloat(ethers.utils.formatUnits(tx.value).toString());

                const _nodePrice = parseFloat(ethers.utils.formatUnits(args['_nodePrice']).toString());
                let tier = getTierFromNodePrice(_nodePrice).toString();
                this.txNodesBuyMap.set(txHash, [numberOfNodes, txValue, tx.from, tier]);

                let child = new Node(owner);
                if (!ownersSet.has(owner)) {
                    ownersSet.add(owner);
                    this.preOrderInsert(parent, child);
                }

                // totalETH = totalETH.add(args['_nodePrice'].mul(args['_numberOfNodes']));
                numberNodeSold += numberOfNodes;
            }

            if (!this.levelMap.has(level.toString())) {
                this.levelMap.set(level.toString(), new Map());
            }
            let map = this.levelMap.get(level.toString());
            if (!map.has(parent.address)) {
                map.set(parent.address, txHashes);
            }
            this.levelMap.set(level.toString(), map);

            // console.log(`Total ETH sold: ${ethers.utils.formatUnits(totalETH.toString())} $ETH`);
            if (level == 0) {
                // console.log(`Number nodes sold by ${parent.address} (root): ${numberNodeSold}\n`);
                let map = this.levelMap.get(level.toString());
                if (!map.has(parent.address)) {
                    map.set(parent.address, txHashes);
                }
                this.levelMap.set(level.toString(), map);
            }

            if (!this.refCountMap.has(parent.address)) {
                this.refCountMap.set(parent.address, ownersSet.size);
            }
            this.saleMap.set(parent.address, numberNodeSold);

        } catch (error) {
            console.error(error);
        }
    }
}

async function treeToJsonFile(inputAddress, maxLevel = 10) {
    console.log(`Saving info of ${inputAddress}`);
    const root = new Node(inputAddress);
    const tree = new Tree(root);
    try {
        await tree.preorderTraversal(root, 1, maxLevel);
    } catch (error) {
        console.log('error: ', error);
        throw new Error("RPC call failed. Please try again");
    }

    try {
        const obj = {};
        const levelMap = Object.fromEntries(tree.levelMap);
        obj.levelMap = {}
        for (const [level, levelContent] of Object.entries(levelMap)) {
            obj.levelMap[level] = Object.fromEntries(levelContent);
        }
        obj.refCountMap = Object.fromEntries(tree.refCountMap);
        obj.txNodesBuyMap = Object.fromEntries(tree.txNodesBuyMap);
        obj.saleMap = Object.fromEntries(tree.saleMap);
        obj.currentTier = tree.currentTier;
        const jsonData = JSON.stringify(obj);
        const filePath = `./data/${inputAddress}.json`;
        await fs.writeFile(filePath, jsonData);
    } catch (error) {
        console.log('error: ', error);
        throw new Error("Write to file error");
    }

    return tree;
}

async function sync() {
    try {
        for (const [username, address] of Object.entries(kolList)) {
            await treeToJsonFile(address.toLowerCase());
        }
    } catch (err) {
        console.error('Error writing to file:', err);
    }
}

module.exports = { treeToJsonFile }