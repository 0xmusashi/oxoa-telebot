function formatAddress(address) {
    return address.slice(0, 4) + '...' + address.slice(-3);
}

function logLevelMap(levelContent, level, refCountMap, txNodesBuyMap, saleMap) {
    let s1 = ``;
    if (level > 0) {
        s1 = `🔗 L${level}:\n`;
    }
    let s2 = '';
    function logTxsMap(txs, user) {
        let s3 = '';
        let numberRef = refCountMap.get(user);
        let userUrl = `https://explorer.zksync.io/address/${user}`;
        s3 = s3.concat(`👨 <a href='${userUrl}'>${formatAddress(user)}</a> sold ${saleMap.get(user)} 🔑 & ${numberRef} direct ref\n\n`);
        if (numberRef > 0) {
            s3 = s3.concat(`\t\tBuy Txs:\n`);
            if (txs.length > 0) {
                for (let i = 0; i < txs.length; i++) {
                    const [numNodes, ethValue, _] = txNodesBuyMap.get(txs[i]);
                    s3 = s3.concat(`\t\t\t🔸 <a href='https://explorer.zksync.io/tx/${txs[i]}'>Buy ${numNodes} 🔑 (${ethValue} $ETH)</a>\n`);
                }
            }
            s3 = s3.concat(`\n`);
        }
        return s3;
    }
    levelContent.forEach((txs, user) => {
        s2 += logTxsMap(txs, user);
    });
    return s1 + s2;
}

function logGeneral(levelContent, level, refCountMap, txNodesBuyMap, saleMap) {
    let numberKeySold = 0;
    let refSet = new Set();
    levelContent.forEach((txs, user) => {
        if (txs.length > 0) {
            for (let i = 0; i < txs.length; i++) {
                const [numNodes, _, from] = txNodesBuyMap.get(txs[i]);
                refSet.add(from);
                numberKeySold += numNodes;
            }
        }
    });
    let numberRef = refSet.size;
    let s = ``;
    if (numberRef > 0) {
        s = `🔗 L${parseInt(level) + 1}: ${refSet.size} ref - ${numberKeySold} 🔑\n`;
    }
    return s;
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
*/

module.exports = { formatAddress, logLevelMap, logGeneral };