const ethers = require("ethers");
const abi = require("./abi.json");

const { CONTRACT_ADDRESS, SPECIAL_ADDRESS, RPC, TIER_PRICE_MAP } = require('./constants');

const provider = new ethers.providers.JsonRpcProvider(RPC);
// Create a contract instance
const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);

function getTierFromNodePrice(price) {
    let prices = [-1.0];
    for (const [_, value] of Object.entries(TIER_PRICE_MAP)) {
        prices.push(value[0]);
    }
    let result = prices.indexOf(parseFloat(price.toFixed(4)));
    return result;
}

async function getSelfRefAddresses(tier) {
    try {

        let users = new Set();
        let userBuy = new Map();
        let txHashes = [];
        const filter = {
            address: CONTRACT_ADDRESS,
            topics: [
                "0x448511bdc0685b88ba7db67a898512cd63b1a760d8beef3e3d10974907845333",
                null, // _owner
                null, // _nodePrice
                null, // _refAddress
            ]
        }

        const events = await contract.queryFilter(filter);

        for (const event of events) {
            const args = event.args;

            const nodePrice = args['_nodePrice'];
            const price = parseFloat(ethers.utils.formatUnits(nodePrice).toString());
            let txTier = getTierFromNodePrice(price).toString();
            if (txTier != tier) {
                continue;
            }


            const owner = args['_owner'];
            if (owner.toLowerCase() == SPECIAL_ADDRESS) {
                continue;
            }

            const refAddress = args['_refAddress'];
            const numKeys = args['_numberOfNodes'].toNumber();
            const txHash = event.transactionHash;

            if (owner == refAddress) {
                txHashes.push(txHash);
                if (!users.has(owner)) {
                    users.add(owner);
                    userBuy.set(owner, numKeys);
                } else {
                    userBuy.set(owner, userBuy.get(owner) + numKeys);
                }
            }
        }

        // return [userBuy, txHashes];
        console.log(`userBuy: `, userBuy);

    } catch (error) {
        // console.error(error);
        throw new Error("RPC failed. Try again later");
    }
}

// getSelfRefAddresses();

module.exports = {
    getSelfRefAddresses
}