const { getSelfRefAddresses } = require('./selfRef');

const {
    TIER_PRICE_MAP,
    TXS_PER_PAGE,
    REFERRERS_PER_PAGE,
    REFERRERS_PER_PAGE_SHOWREF,
    LAST_5_TX
} = require('./constants');

function formatAddress(address) {
    return address.slice(0, 4) + '...' + address.slice(-3);
}

function getLevelFromCommand(match) {
    const s = match[0];
    const level = s.split(' ')[0].split('lv')[1];
    return level;
}

function getTierFromTxValueAndNumKeys(value, numKeys) {
    let price = value / numKeys;
    let prices = [-1.0];
    for (const [_, value] of Object.entries(TIER_PRICE_MAP)) {
        prices.push(value[0]);
    }
    let result = prices.indexOf(parseFloat(price.toFixed(4)));
    return result;
}

function splitArrayWithOffset(arr, size, offset = 0) {
    if (!Array.isArray(arr) || size <= 0 || offset < 0) {
        throw new Error('Invalid arguments: array, size, and offset must be valid.');
    }

    const subarrays = [];
    let startIndex = 0;

    while (startIndex < arr.length) {
        const endIndex = Math.min(startIndex + size - offset, arr.length);
        const subarray = arr.slice(startIndex, endIndex);
        if (subarray.length > 0) {
            subarrays.push(subarray);
        }
        startIndex = endIndex;
    }

    return subarrays;
}

function logPageCodeType(levelContent, refCode, refCountMap, txNodesBuyMap, saleMap, page = 1, tier) {
    let s2 = '';
    let allLogs = [];
    let levelKeySale = 0;
    let levelSubRef = 0;
    let subrefSet = new Set();
    function logTxsMap(txs, user) {
        let logs = [];
        let numberRef = refCountMap.get(user);
        let oxoaPercentage = 5;

        const [NO_CODE_PRICE, CODE_20_PRICE, CODE_100_PRICE] = TIER_PRICE_MAP[tier];

        if (numberRef > 0 && txs.length > 0) {
            for (let i = 0; i < txs.length; i++) {
                const [numNodes, ethValue, from, txTier] = txNodesBuyMap.get(txs[i]);
                if (txTier != tier) {
                    continue;
                }
                subrefSet.add(from);
                let k = `🔑`;
                let code = '0';
                if (ethValue == parseFloat((NO_CODE_PRICE * numNodes).toFixed(4))) {
                    k = `🔑`;
                    code = '0';
                } else if (ethValue == parseFloat((CODE_20_PRICE * numNodes).toFixed(4))) {
                    k = `🗝`;
                    code = '20';
                } else if (ethValue == parseFloat((CODE_100_PRICE * numNodes).toFixed(4))) {
                    k = `🎁`;
                    code = '100';
                }
                levelKeySale += numNodes;

                const oxoaReward = (ethValue * oxoaPercentage / 100).toFixed(4);
                const bonusReward = 0;
                let log = `\t\t\t\t\t🔸 <a href='https://explorer.zksync.io/tx/${txs[i]}'>Buy ${numNodes} ${k} (${parseFloat(ethValue)} $ETH) | Reward ${oxoaPercentage}% (${parseFloat(oxoaReward)} $ETH) | Bonus reward (${parseFloat(bonusReward)} $ETH)</a>\n`;

                if (code == refCode) {
                    logs.push(log);
                }

                if (txs[i].toLowerCase() == LAST_5_TX) {
                    oxoaPercentage = 17;
                }
            }
        }
        return logs;
    }

    levelContent.forEach((txs, user) => {
        let logs = logTxsMap(txs, user);
        allLogs = [...allLogs, ...logs];
    });

    const splitLogs = splitArrayWithOffset(allLogs, TXS_PER_PAGE);

    let numPages = splitLogs.length;
    if (page > numPages) {
        s2 += `No more tx\n`;
    } else {
        const dipslayText = splitLogs[page - 1];
        for (const text of dipslayText) {
            s2 += text;
        }
    }

    levelSubRef = subrefSet.size;

    return [s2, numPages, levelKeySale, levelSubRef];
}

function logGeneral(levelContent, level, refCountMap, txNodesBuyMap, saleMap, tier) {

    let numberKeySold = 0;
    let totalSale = 0.0;
    let refSet = new Set();

    let numNoCodeKeySold = 0;
    let numCode20KeySold = 0;
    let numCode100KeySold = 0;

    const [NO_CODE_PRICE, CODE_20_PRICE, CODE_100_PRICE] = TIER_PRICE_MAP[tier];

    levelContent.forEach((txs, user) => {
        if (txs.length > 0) {
            for (let i = 0; i < txs.length; i++) {
                const [numNodes, txValue, from, txTier] = txNodesBuyMap.get(txs[i]);

                if (txValue == parseFloat((NO_CODE_PRICE * numNodes).toFixed(4))) {
                    numNoCodeKeySold += numNodes;
                    refSet.add(from);
                } else if (txValue == parseFloat((CODE_20_PRICE * numNodes).toFixed(4))) {
                    numCode20KeySold += numNodes;
                    refSet.add(from);
                } else if (txValue == parseFloat((CODE_100_PRICE * numNodes).toFixed(4))) {
                    numCode100KeySold += numNodes;
                    refSet.add(from);
                } else {
                    if (txTier == tier) {
                        console.log(`tx: ${txs[i]}`);
                    }
                }
            }
        }
    });
    let numberRef = refSet.size;
    let s = ``;
    if (numberRef > 0) {
        let nocodeSale = numNoCodeKeySold * NO_CODE_PRICE;
        let code20Sale = numCode20KeySold * CODE_20_PRICE;
        let code100Sale = numCode100KeySold * CODE_100_PRICE;
        totalSale = nocodeSale + code20Sale + code100Sale;
        numberKeySold += numNoCodeKeySold + numCode20KeySold + numCode100KeySold;

        s += `🔗 L${parseInt(level)}: ${refSet.size} ref - ${numberKeySold} keys - Level sale: ${parseFloat(totalSale.toFixed(4))} $ETH\n\n`;
        s += `      0 %     :   ${numNoCodeKeySold} 🔑 (${parseFloat(nocodeSale.toFixed(4))} $ETH) \n`;
        s += `      20 %   :   ${numCode20KeySold} 🗝 (${parseFloat(code20Sale.toFixed(4))} $ETH) \n`;
        s += `      100 % :   ${numCode100KeySold} 🎁 (${parseFloat(code100Sale.toFixed(4))} $ETH) \n\n`;
    }
    return [s, numberKeySold, totalSale];
}

function logReferralsListByLevel(levelContent, level, refCountMap, txNodesBuyMap, saleMap, page, tier) {
    let s = ``;
    let allLogs = [];
    let refSet = new Set();
    let refNumKeysMap = new Map();
    let refTxMap = new Map();
    levelContent.forEach((txs, user) => {
        let logs = [];
        if (txs.length > 0) {
            for (let i = 0; i < txs.length; i++) {
                const [numKeys, txValue, from, txTier] = txNodesBuyMap.get(txs[i]);
                if (tier != txTier) {
                    continue;
                }

                if (!refNumKeysMap.has(from)) {
                    refNumKeysMap.set(from, numKeys);
                } else {
                    refNumKeysMap.set(from, refNumKeysMap.get(from) + numKeys);
                }

                if (!refTxMap.has(from)) {
                    refTxMap.set(from, [txs[i]]);
                } else {
                    refTxMap.set(from, [...refTxMap.get(from), txs[i]]);
                }

                refSet.add(from);

            }

            refSet.forEach((user) => {
                let userUrl = `https://explorer.zksync.io/address/${user}`;
                let numKeys = refNumKeysMap.get(user);
                logs.push(`👨 <a href='${userUrl}'>${formatAddress(user)} (buy ${numKeys} 🔑)</a>\n\n`);
            });
        }
        allLogs = [...allLogs, ...logs];
    });

    const splitLogs = splitArrayWithOffset(allLogs, REFERRERS_PER_PAGE);

    let numPages = splitLogs.length;
    if (page > numPages) {
        s += `Nothing to show\n`;
    } else {
        const dipslayText = splitLogs[page - 1];
        for (const text of dipslayText) {
            s += text;
        }
    }
    const totalRef = refSet.size;
    return [s, numPages, totalRef];
}

function logReferralsListByLevelNsb(levelContent, level, refCountMap, txNodesBuyMap, saleMap, page, tier) {
    let s = ``;
    let allLogs = [];
    let refSet = new Set();
    let refNumKeysMap = new Map();
    let refTxMap = new Map();
    levelContent.forEach((txs, user) => {
        let logs = [];
        if (txs.length > 0) {
            for (let i = 0; i < txs.length; i++) {
                const [numKeys, txValue, from, txTier] = txNodesBuyMap.get(txs[i]);

                if (tier != txTier) {
                    continue;
                }

                if (!refNumKeysMap.has(from)) {
                    refNumKeysMap.set(from, numKeys);
                } else {
                    refNumKeysMap.set(from, refNumKeysMap.get(from) + numKeys);
                }

                if (!refTxMap.has(from)) {
                    refTxMap.set(from, [txs[i]]);
                } else {
                    refTxMap.set(from, [...refTxMap.get(from), txs[i]]);
                }

                refSet.add(from);

            }

            refSet.forEach((user) => {
                let userUrl = `https://explorer.zksync.io/address/${user}`;
                let numKeys = refNumKeysMap.get(user);
                let numSubRef = refCountMap.get(user);
                if (numSubRef > 0) {
                    logs.push(`👨 <a href='${userUrl}'>${formatAddress(user)} (buy ${numKeys} 🔑)</a> (${numSubRef} ref - ${saleMap.get(user)} 🔑) \n\n`);
                }
            });
        }
        allLogs = [...allLogs, ...logs];
    });

    const splitLogs = splitArrayWithOffset(allLogs, REFERRERS_PER_PAGE_SHOWREF);

    let numPages = splitLogs.length;
    // if (page > numPages) {
    //     s += `Nothing to show\n`;
    // } else {
    //     const dipslayText = splitLogs[page - 1];
    //     for (const text of dipslayText) {
    //         s += text;
    //     }
    // }
    for (const text of allLogs) {
        s += text;
    }
    const totalRef = refSet.size;
    return [s, numPages, totalRef];
}

/*
levelMap = { 
    '0': {
        '0x4890240240...': [txs],
        '0x3213234242...': [txs],
        ...
    },
    '1': {
        '0x4890240240...': [txs],
        '0x3213234242...': [txs],
        ...
    }
}

refCountMap = {
    '0x4890240240...': 32,
    '0x3213234242...': 10,
    ...
}

txNodesBuyMap = {
    'txHash': [numberNodeSold, ETH pay, msg.sender]
}

saleMapNoCode = {
    '0x4890240240...': 10,
    '0x3213234242...': 10,
    ...
}
*/

module.exports = {
    getLevelFromCommand,
    formatAddress,
    logGeneral,
    logPageCodeType,
    logReferralsListByLevel,
    logReferralsListByLevelNsb,
    getTierFromTxValueAndNumKeys
};