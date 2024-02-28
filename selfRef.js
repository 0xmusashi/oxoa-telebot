const ethers = require("ethers");
const fs = require('fs');
const abi = require("./abi.json");

const CONTRACT_ADDRESS = '0x2a88444D7A5626e52928D9799ae15F0Bb273bFbd';
const RPC = 'https://mainnet.era.zksync.io';

const provider = new ethers.providers.JsonRpcProvider(RPC);
// Create a contract instance
const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);

async function getSelfRefAddresses() {
    try {

        let users = new Set();
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
            const txHash = event.transactionHash;
            const owner = args['_owner'];
            const refAddress = args['_refAddress'];
            if (owner == refAddress) {
                txHashes.push(txHash);
                users.add(owner);
            }
        }

        let usersList = [];
        users.forEach(user => {
            usersList.push(user);
        });
        const usersContent = usersList.join('\n');
        const txContent = txHashes.join('\n');

        const userFilePath = 'self_ref_users.txt';
        fs.writeFile(userFilePath, usersContent, (err) => {
            if (err) {
                console.error('Error writing file:', err);
            } else {
                console.log(`Data written to file: ${userFilePath}`);
            }
        });

        const txFilePath = 'self_ref_txs.txt';
        fs.writeFile(txFilePath, txContent, (err) => {
            if (err) {
                console.error('Error writing file:', err);
            } else {
                console.log(`Data written to file: ${txFilePath}`);
            }
        });

    } catch (error) {
        console.error(error);
    }
}

getSelfRefAddresses();