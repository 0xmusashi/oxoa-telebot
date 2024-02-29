const ethers = require("ethers");
const abi = require("./abi.json");
const kolList = require("./kolList.json");
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const {
    getLevelFromCommand,
    formatAddress,
    logGeneral,
    logPageCodeType,
    logReferralsListByLevel,
    logReferralsListByLevelNsb,
    getTierFromTxValueAndNumKeys
} = require('./utils');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

const CONTRACT_ADDRESS = '0x2a88444D7A5626e52928D9799ae15F0Bb273bFbd';
const RPC = 'https://mainnet.era.zksync.io';

const provider = new ethers.providers.JsonRpcProvider(RPC);

const ADMIN_IDS = [2127544523, 1559803968, 5728990868, 5413592753, 278657276];
const REF_CODES = ['0', '20', '100'];
const TIERS = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10', 't11', 't12', 't13', 't14', 't15',
    't16', 't17', 't18', 't19', 't20', 't21', 't22', 't23', 't24', 't25'
];

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

                let tier = getTierFromTxValueAndNumKeys(txValue, numberOfNodes).toString();
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

async function main(inputAddress, maxLevel = 10) {
    console.log(`Referrals of ${inputAddress}`);
    const root = new Node(inputAddress);
    const tree = new Tree(root);
    try {
        await tree.preorderTraversal(root, 1, maxLevel);
    } catch (error) {
        throw new Error("RPC call failed. Please try again");
    }

    return tree;
}

bot.onText(/\/ref (.+) (.+)/, async (msg, match) => {
    const username = match[1].toLowerCase();
    const tierParam = match[2].toLowerCase();
    if (!TIERS.includes(tierParam)) {
        console.log(`invalid tier ${tierParam}`);
        await bot.sendMessage(msg.chat.id, `Invalid tier ${tierParam}`);
        return;
    }
    const tier = tierParam.split('t')[1];
    let address = kolList[username];
    if (!address) {
        address = username;
    }
    if (!ADMIN_IDS.includes(msg.from.id)) {
        console.log(`unauthorized user ${msg.from.id}`);
        await bot.sendMessage(msg.chat.id, `You are unauthorized to call this`);
        return; // Ignore messages from unauthorized users
    }
    try {
        const tree = await main(address);
        const levelMap = tree.levelMap;
        const refCountMap = tree.refCountMap;
        const txNodesBuyMap = tree.txNodesBuyMap;
        const saleMap = tree.saleMap;

        const userUrl = `https://explorer.zksync.io/address/${address}`;
        let message = `👨 <b><a href='${userUrl}'>${formatAddress(address)}</a> General Ref Info - Tier ${tier}</b>\n\n`;

        let s = ``;
        let totalKeys = 0;
        let totalSaleETH = 0.0;

        levelMap.forEach((values, key) => {
            const [s1, numKeys, saleETH] = logGeneral(values, key, refCountMap, txNodesBuyMap, saleMap, tier);
            s += s1;
            totalKeys += numKeys;
            totalSaleETH += saleETH;
        });

        message += `💲<b>Total sale: ${totalKeys} keys (${parseFloat(totalSaleETH.toFixed(4))} $ETH)</b>\n\n`;
        message += s;

        const opts = {
            parse_mode: 'HTML',
        }

        await bot.sendMessage(msg.chat.id, message, opts);
    } catch (error) {
        await bot.sendMessage(msg.chat.id, 'Error. Please try again later.');
        console.log(`err: ${error}`)
    }
});

bot.onText(/\/list (.+) (.+) (.+) (.+)/, async (msg, match) => {
    const username = match[1].toLowerCase();
    let address = kolList[username];
    if (!address) {
        address = username;
    }
    const level = match[2];
    const page = parseInt(match[3]);
    const tierParam = match[4].toLowerCase();
    if (!TIERS.includes(tierParam)) {
        console.log(`invalid tier ${tierParam}`);
        await bot.sendMessage(msg.chat.id, `Invalid tier ${tierParam}`);
        return;
    }
    const tier = tierParam.split('t')[1];
    try {
        if (parseInt(level) < 1) {
            throw Error("level must be >= 1");
        }
        const tree = await main(address, parseInt(level));
        const levelMap = tree.levelMap;
        const refCountMap = tree.refCountMap;
        const txNodesBuyMap = tree.txNodesBuyMap;
        const saleMap = tree.saleMap;

        let userUrl = `https://explorer.zksync.io/address/${address}`;
        let message = `👨 <b><a href='${userUrl}'>${formatAddress(address)}</a> ref list</b>\n\n`;
        if (!levelMap.has(level)) {
            message += `User has 0️⃣ ref in this level. Try again later!`;
        } else {
            let levelContent = levelMap.get(level);
            const [s, numPages, totalRef] = logReferralsListByLevel(levelContent, level, refCountMap, txNodesBuyMap, saleMap, page, tier);

            message += `🔗 <b>Level ${parseInt(level)} - tier ${tier} - total ref: ${totalRef} (page ${page}/${numPages})</b>\n\n`;
            message += s;
        }

        const opts = {
            parse_mode: 'HTML',
        }

        await bot.sendMessage(msg.chat.id, message, opts);
    } catch (error) {
        await bot.sendMessage(msg.chat.id, 'Error. Please try again later.');
        console.log(`err: ${error}`)
    }
});

bot.onText(/\/showRef (.+) (.+) (.+)/, async (msg, match) => {
    const username = match[1].toLowerCase();
    let address = kolList[username];
    if (!address) {
        address = username;
    }
    if (!ADMIN_IDS.includes(msg.from.id)) {
        console.log(`unauthorized user ${msg.from.id}`);
        return; // Ignore messages from unauthorized users
    }
    const page = parseInt(match[2]);

    const tierParam = match[3].toLowerCase();
    if (!TIERS.includes(tierParam)) {
        console.log(`invalid tier ${tierParam}`);
        await bot.sendMessage(msg.chat.id, `Invalid tier ${tierParam}`);
        return;
    }
    const tier = tierParam.split('t')[1];

    const level = '1';
    try {
        const tree = await main(address, parseInt(level) + 1);
        const levelMap = tree.levelMap;
        const refCountMap = tree.refCountMap;
        const txNodesBuyMap = tree.txNodesBuyMap;
        const saleMap = tree.saleMap;

        let userUrl = `https://explorer.zksync.io/address/${address}`;
        let message = `👨 <b><a href='${userUrl}'>${formatAddress(address)}</a> ref list</b>\n\n`;
        if (!levelMap.has(level)) {
            message += `User has 0️⃣ ref in this level. Try again later!`;
        } else {
            let levelContent = levelMap.get(level);
            const [s, numPages, totalRef] = logReferralsListByLevelNsb(levelContent, level, refCountMap, txNodesBuyMap, saleMap, page, tier);

            message += `🔗 <b>Level ${parseInt(level)} - tier ${tier} - total ref: ${totalRef}</b>\n\n`;
            message += s;
        }

        const opts = {
            parse_mode: 'HTML',
        }

        await bot.sendMessage(msg.chat.id, message, opts);
    } catch (error) {
        await bot.sendMessage(msg.chat.id, 'Error. Please try again later.');
        console.log(`err: ${error}`)
    }
});

bot.onText(/\/lv1 (.+) (.+) (.+) (.+)/, async (msg, match) => {
    const level = getLevelFromCommand(match);
    const username = match[1].toLowerCase();
    let address = kolList[username];
    if (!address) {
        address = username;
    }
    const refCode = match[2];
    if (!REF_CODES.includes(refCode)) {
        const opts = {
            parse_mode: 'HTML',
        }
        const message = `Invalid ref code ${refCode}`;
        await bot.sendMessage(msg.chat.id, message, opts);
        return;
    }
    const page = parseInt(match[3]);
    const tierParam = match[4].toLowerCase();
    if (!TIERS.includes(tierParam)) {
        console.log(`invalid tier ${tierParam}`);
        await bot.sendMessage(msg.chat.id, `Invalid tier ${tierParam}`);
        return;
    }
    const tier = tierParam.split('t')[1];
    try {
        const tree = await main(address, parseInt(level));
        const levelMap = tree.levelMap;
        const refCountMap = tree.refCountMap;
        const txNodesBuyMap = tree.txNodesBuyMap;
        const saleMap = tree.saleMap;

        let message = '';
        if (!levelMap.has(level)) {
            message += `User has 0️⃣ tier ${tier} ref in this level. Try again later!`;
        } else {
            let levelContent = levelMap.get(level);

            const [s, numPages, levelKeySale, levelSubRef] = logPageCodeType(levelContent, refCode, refCountMap, txNodesBuyMap, saleMap, page, tier);

            let numberRef = refCountMap.get(address);
            let userUrl = `https://explorer.zksync.io/address/${address}`;
            message += `👨 <a href='${userUrl}'>${formatAddress(address)}</a> sold ${levelKeySale} 🔑 & ${levelSubRef} direct ref\n\n`;
            message += `🔗 Direct ref - ${refCode}% discount sale - Tier ${tier} - (page ${page}/${numPages}):\n\n`;

            message += `\t\t\t\t🏷Sale transactions:\n\n`;

            message += s;
        }

        const opts = {
            parse_mode: 'HTML',
        }

        await bot.sendMessage(msg.chat.id, message, opts);
    } catch (error) {
        await bot.sendMessage(msg.chat.id, 'Error. Please try again later.');
        console.log(`err: ${error}`)
    }
});

bot.onText(/\/lv2 (.+) (.+) (.+) (.+)/, async (msg, match) => {
    const level = getLevelFromCommand(match);
    const username = match[1].toLowerCase();
    let address = kolList[username];
    if (!address) {
        address = username;
    }
    const refCode = match[2];
    if (!REF_CODES.includes(refCode)) {
        const opts = {
            parse_mode: 'HTML',
        }
        const message = `Invalid ref code ${refCode}`;
        await bot.sendMessage(msg.chat.id, message, opts);
        return;
    }
    const page = parseInt(match[3]);
    const tierParam = match[4].toLowerCase();
    if (!TIERS.includes(tierParam)) {
        console.log(`invalid tier ${tierParam}`);
        await bot.sendMessage(msg.chat.id, `Invalid tier ${tierParam}`);
        return;
    }
    const tier = tierParam.split('t')[1];
    try {
        const tree = await main(address, parseInt(level));
        const levelMap = tree.levelMap;
        const refCountMap = tree.refCountMap;
        const txNodesBuyMap = tree.txNodesBuyMap;
        const saleMap = tree.saleMap;

        let message = '';
        if (!levelMap.has(level)) {
            message += `User has 0️⃣ tier ${tier} ref in this level. Try again later!`;
        } else {
            let levelContent = levelMap.get(level);

            const [s, numPages, levelKeySale, levelSubRef] = logPageCodeType(levelContent, refCode, refCountMap, txNodesBuyMap, saleMap, page, tier);

            let userUrl = `https://explorer.zksync.io/address/${address}`;
            message += `👨 <a href='${userUrl}'>${formatAddress(address)}</a> sold ${levelKeySale} 🔑 & ${levelSubRef} ref\n\n`;
            message += `🔗 Level ${level} ref - ${refCode}% discount sale - Tier ${tier} - (page ${page}/${numPages}):\n\n`;

            message += `\t\t\t\t🏷Sale transactions:\n\n`;

            message += s;
        }

        const opts = {
            parse_mode: 'HTML',
        }

        await bot.sendMessage(msg.chat.id, message, opts);
    } catch (error) {
        await bot.sendMessage(msg.chat.id, 'Error. Please try again later.');
        console.log(`err: ${error}`)
    }
});

bot.onText(/\/lv3 (.+) (.+) (.+) (.+)/, async (msg, match) => {
    const level = getLevelFromCommand(match);
    const username = match[1].toLowerCase();
    let address = kolList[username];
    if (!address) {
        address = username;
    }
    const refCode = match[2];
    if (!REF_CODES.includes(refCode)) {
        const opts = {
            parse_mode: 'HTML',
        }
        const message = `Invalid ref code ${refCode}`;
        await bot.sendMessage(msg.chat.id, message, opts);
        return;
    }
    const page = parseInt(match[3]);
    const tierParam = match[4].toLowerCase();
    if (!TIERS.includes(tierParam)) {
        console.log(`invalid tier ${tierParam}`);
        await bot.sendMessage(msg.chat.id, `Invalid tier ${tierParam}`);
        return;
    }
    const tier = tierParam.split('t')[1];
    try {
        const tree = await main(address, parseInt(level));
        const levelMap = tree.levelMap;
        const refCountMap = tree.refCountMap;
        const txNodesBuyMap = tree.txNodesBuyMap;
        const saleMap = tree.saleMap;

        let message = '';
        if (!levelMap.has(level)) {
            message += `User has 0️⃣ tier ${tier} ref in this level. Try again later!`;
        } else {
            let levelContent = levelMap.get(level);

            const [s, numPages, levelKeySale, levelSubRef] = logPageCodeType(levelContent, refCode, refCountMap, txNodesBuyMap, saleMap, page, tier);

            let userUrl = `https://explorer.zksync.io/address/${address}`;
            message += `👨 <a href='${userUrl}'>${formatAddress(address)}</a> sold ${levelKeySale} 🔑 & ${levelSubRef} ref\n\n`;
            message += `🔗 Level ${level} ref - ${refCode}% discount sale - Tier ${tier} - (page ${page}/${numPages}):\n\n`;

            message += `\t\t\t\t🏷Sale transactions:\n\n`;

            message += s;
        }

        const opts = {
            parse_mode: 'HTML',
        }

        await bot.sendMessage(msg.chat.id, message, opts);
    } catch (error) {
        await bot.sendMessage(msg.chat.id, 'Error. Please try again later.');
        console.log(`err: ${error}`)
    }
});

bot.onText(/\/lv4 (.+) (.+) (.+) (.+)/, async (msg, match) => {
    const level = getLevelFromCommand(match);
    const username = match[1].toLowerCase();
    let address = kolList[username];
    if (!address) {
        address = username;
    }
    const refCode = match[2];
    if (!REF_CODES.includes(refCode)) {
        const opts = {
            parse_mode: 'HTML',
        }
        const message = `Invalid ref code ${refCode}`;
        await bot.sendMessage(msg.chat.id, message, opts);
        return;
    }
    const page = parseInt(match[3]);
    const tierParam = match[4].toLowerCase();
    if (!TIERS.includes(tierParam)) {
        console.log(`invalid tier ${tierParam}`);
        await bot.sendMessage(msg.chat.id, `Invalid tier ${tierParam}`);
        return;
    }
    const tier = tierParam.split('t')[1];
    try {
        const tree = await main(address, parseInt(level));
        const levelMap = tree.levelMap;
        const refCountMap = tree.refCountMap;
        const txNodesBuyMap = tree.txNodesBuyMap;
        const saleMap = tree.saleMap;

        let message = '';
        if (!levelMap.has(level)) {
            message += `User has 0️⃣ tier ${tier} ref in this level. Try again later!`;
        } else {
            let levelContent = levelMap.get(level);

            const [s, numPages, levelKeySale, levelSubRef] = logPageCodeType(levelContent, refCode, refCountMap, txNodesBuyMap, saleMap, page, tier);

            let userUrl = `https://explorer.zksync.io/address/${address}`;
            message += `👨 <a href='${userUrl}'>${formatAddress(address)}</a> sold ${levelKeySale} 🔑 & ${levelSubRef} ref\n\n`;
            message += `🔗 Level ${level} ref - ${refCode}% discount sale - Tier ${tier} - (page ${page}/${numPages}):\n\n`;

            message += `\t\t\t\t🏷Sale transactions:\n\n`;

            message += s;
        }

        const opts = {
            parse_mode: 'HTML',
        }

        await bot.sendMessage(msg.chat.id, message, opts);
    } catch (error) {
        await bot.sendMessage(msg.chat.id, 'Error. Please try again later.');
        console.log(`err: ${error}`)
    }
});

bot.onText(/\/lv5 (.+) (.+) (.+) (.+)/, async (msg, match) => {
    const level = getLevelFromCommand(match);
    const username = match[1].toLowerCase();
    let address = kolList[username];
    if (!address) {
        address = username;
    }
    const refCode = match[2];
    if (!REF_CODES.includes(refCode)) {
        const opts = {
            parse_mode: 'HTML',
        }
        const message = `Invalid ref code ${refCode}`;
        await bot.sendMessage(msg.chat.id, message, opts);
        return;
    }
    const page = parseInt(match[3]);
    const tierParam = match[4].toLowerCase();
    if (!TIERS.includes(tierParam)) {
        console.log(`invalid tier ${tierParam}`);
        await bot.sendMessage(msg.chat.id, `Invalid tier ${tierParam}`);
        return;
    }
    const tier = tierParam.split('t')[1];
    try {
        const tree = await main(address, parseInt(level));
        const levelMap = tree.levelMap;
        const refCountMap = tree.refCountMap;
        const txNodesBuyMap = tree.txNodesBuyMap;
        const saleMap = tree.saleMap;

        let message = '';
        if (!levelMap.has(level)) {
            message += `User has 0️⃣ tier ${tier} ref in this level. Try again later!`;
        } else {
            let levelContent = levelMap.get(level);

            const [s, numPages, levelKeySale, levelSubRef] = logPageCodeType(levelContent, refCode, refCountMap, txNodesBuyMap, saleMap, page, tier);

            let userUrl = `https://explorer.zksync.io/address/${address}`;
            message += `👨 <a href='${userUrl}'>${formatAddress(address)}</a> sold ${levelKeySale} 🔑 & ${levelSubRef} ref\n\n`;
            message += `🔗 Level ${level} ref - ${refCode}% discount sale - Tier ${tier} - (page ${page}/${numPages}):\n\n`;

            message += `\t\t\t\t🏷Sale transactions:\n\n`;

            message += s;
        }

        const opts = {
            parse_mode: 'HTML',
        }

        await bot.sendMessage(msg.chat.id, message, opts);
    } catch (error) {
        await bot.sendMessage(msg.chat.id, 'Error. Please try again later.');
        console.log(`err: ${error}`)
    }
});

bot.onText(/\/lv6 (.+) (.+) (.+) (.+)/, async (msg, match) => {
    const level = getLevelFromCommand(match);
    const username = match[1].toLowerCase();
    let address = kolList[username];
    if (!address) {
        address = username;
    }
    const refCode = match[2];
    if (!REF_CODES.includes(refCode)) {
        const opts = {
            parse_mode: 'HTML',
        }
        const message = `Invalid ref code ${refCode}`;
        await bot.sendMessage(msg.chat.id, message, opts);
        return;
    }
    const page = parseInt(match[3]);
    const tierParam = match[4].toLowerCase();
    if (!TIERS.includes(tierParam)) {
        console.log(`invalid tier ${tierParam}`);
        await bot.sendMessage(msg.chat.id, `Invalid tier ${tierParam}`);
        return;
    }
    const tier = tierParam.split('t')[1];
    try {
        const tree = await main(address, parseInt(level));
        const levelMap = tree.levelMap;
        const refCountMap = tree.refCountMap;
        const txNodesBuyMap = tree.txNodesBuyMap;
        const saleMap = tree.saleMap;

        let message = '';
        if (!levelMap.has(level)) {
            message += `User has 0️⃣ tier ${tier} ref in this level. Try again later!`;
        } else {
            let levelContent = levelMap.get(level);

            const [s, numPages, levelKeySale, levelSubRef] = logPageCodeType(levelContent, refCode, refCountMap, txNodesBuyMap, saleMap, page, tier);

            let userUrl = `https://explorer.zksync.io/address/${address}`;
            message += `👨 <a href='${userUrl}'>${formatAddress(address)}</a> sold ${levelKeySale} 🔑 & ${levelSubRef} ref\n\n`;
            message += `🔗 Level ${level} ref - ${refCode}% discount sale - Tier ${tier} - (page ${page}/${numPages}):\n\n`;

            message += `\t\t\t\t🏷Sale transactions:\n\n`;

            message += s;
        }

        const opts = {
            parse_mode: 'HTML',
        }

        await bot.sendMessage(msg.chat.id, message, opts);
    } catch (error) {
        await bot.sendMessage(msg.chat.id, 'Error. Please try again later.');
        console.log(`err: ${error}`)
    }
});

bot.onText(/\/lv7 (.+) (.+) (.+) (.+)/, async (msg, match) => {
    const level = getLevelFromCommand(match);
    const username = match[1].toLowerCase();
    let address = kolList[username];
    if (!address) {
        address = username;
    }
    const refCode = match[2];
    if (!REF_CODES.includes(refCode)) {
        const opts = {
            parse_mode: 'HTML',
        }
        const message = `Invalid ref code ${refCode}`;
        await bot.sendMessage(msg.chat.id, message, opts);
        return;
    }
    const page = parseInt(match[3]);
    const tierParam = match[4].toLowerCase();
    if (!TIERS.includes(tierParam)) {
        console.log(`invalid tier ${tierParam}`);
        await bot.sendMessage(msg.chat.id, `Invalid tier ${tierParam}`);
        return;
    }
    const tier = tierParam.split('t')[1];
    try {
        const tree = await main(address, parseInt(level));
        const levelMap = tree.levelMap;
        const refCountMap = tree.refCountMap;
        const txNodesBuyMap = tree.txNodesBuyMap;
        const saleMap = tree.saleMap;

        let message = '';
        if (!levelMap.has(level)) {
            message += `User has 0️⃣ tier ${tier} ref in this level. Try again later!`;
        } else {
            let levelContent = levelMap.get(level);

            const [s, numPages, levelKeySale, levelSubRef] = logPageCodeType(levelContent, refCode, refCountMap, txNodesBuyMap, saleMap, page, tier);

            let userUrl = `https://explorer.zksync.io/address/${address}`;
            message += `👨 <a href='${userUrl}'>${formatAddress(address)}</a> sold ${levelKeySale} 🔑 & ${levelSubRef} ref\n\n`;
            message += `🔗 Level ${level} ref - ${refCode}% discount sale - Tier ${tier} - (page ${page}/${numPages}):\n\n`;

            message += `\t\t\t\t🏷Sale transactions:\n\n`;

            message += s;
        }

        const opts = {
            parse_mode: 'HTML',
        }

        await bot.sendMessage(msg.chat.id, message, opts);
    } catch (error) {
        await bot.sendMessage(msg.chat.id, 'Error. Please try again later.');
        console.log(`err: ${error}`)
    }
});