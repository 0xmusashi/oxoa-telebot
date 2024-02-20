const ethers = require("ethers");
const abi = require("./abi.json");

const CONTRACT_ADDRESS = '0x2a88444D7A5626e52928D9799ae15F0Bb273bFbd';
const RPC = 'https://mainnet.era.zksync.io';

const provider = new ethers.providers.JsonRpcProvider(RPC);

const REF_ADDRESS = '0x3E657D3CF4cb2104E6A5a6eD6f19aE23d8869999';

async function getNewNodeEvents() {
    try {
        // Create a contract instance
        const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);

        const filter = {
            address: CONTRACT_ADDRESS,
            topics: [
                // ethers.utils.id("NewNode(uint256,address,uint256,uint256,uint256,address"),
                "0x448511bdc0685b88ba7db67a898512cd63b1a760d8beef3e3d10974907845333",
                null, // _owner
                null, // _nodePrice
                ethers.utils.hexZeroPad(REF_ADDRESS, 32), // _refAddress
            ]
        }

        const events = await contract.queryFilter(filter);

        const owners = [];
        for (const event of events) {
            const args = event.args;
            owners.push(args['_owner']);
        }
        console.log('Owners: ', owners);
    } catch (error) {
        console.error(error);
    }
}

getNewNodeEvents();