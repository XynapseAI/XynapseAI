// utils/aggregateWorker.js

export function aggregateInWorker(incomingData, outgoingData, layer3Data, rootAddress, page, filterType) {
  return new Promise((resolve, reject) => {
    const workerCode = `
      const isValidDate = (date) => date instanceof Date && !isNaN(date);
      const formatLargeNumber = (value, decimals = 1) => {
        const absValue = Math.abs(value);
        if (absValue >= 1e9) return \`\${Number((value / 1e9).toFixed(decimals))}B\`;
        if (absValue >= 1e6) return \`\${Number((value / 1e6).toFixed(decimals))}M\`;
        if (absValue >= 1e3) return \`\${Number((value / 1e3).toFixed(decimals))}K\`;
        return Number(value.toFixed(decimals)).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      };
      const aggregateWallets = (incomingData, outgoingData, layer3Data, rootAddress, page, filterType) => {
        const walletMap = new Map();
        const nametags = {};
        const edges = [];
        const rootLower = rootAddress.toLowerCase();
        walletMap.set(rootLower, {
          address: rootLower,
          nametag: 'Unknown', // Placeholder, sẽ được cập nhật sau
          image: '/icons/default.webp',
          chainLogo: '/icons/default.webp',
          tokenSymbol: 'Unknown',
          totalValue: 0,
          txCount: 0,
          latestBlockTime: null,
          type: 'root',
          layer: 1,
        });
        nametags[rootLower] = {
          name: 'Unknown',
          image: '/icons/default.webp',
        };
        const addWallet = (address, tx, type, layer) => {
          if (filterType === 'incoming' && type !== 'incoming') return;
          if (filterType === 'outgoing' && type !== 'outgoing') return;
          if (layer === 3 && (!tx.nametag || tx.nametag === 'Unknown')) return;
          const addrLower = address.toLowerCase();
          if (!walletMap.has(addrLower)) {
            walletMap.set(addrLower, {
              address: addrLower,
              nametag: tx.nametag || 'Unknown',
              image: tx.image || '/icons/default.webp',
              chainLogo: tx.chainLogo || '/icons/default.webp',
              tokenSymbol: tx.tokenSymbol || 'Unknown',
              totalValue: 0,
              txCount: 0,
              latestBlockTime: null,
              type,
              layer,
            });
            nametags[addrLower] = {
              name: tx.nametag || 'Unknown',
              image: tx.image || '/icons/default.webp',
            };
          }
          const wallet = walletMap.get(addrLower);
          const txValue = Number(tx.usdValue || tx.value || 0);
          if (isNaN(txValue)) return; // Validate value
          wallet.totalValue += txValue;
          wallet.txCount += 1;
          const txTime = typeof tx.block_time === 'number' ? tx.block_time * 1000 : tx.block_time;
          const walletTime = wallet.latestBlockTime ? (typeof wallet.latestBlockTime === 'number' ? wallet.latestBlockTime * 1000 : wallet.latestBlockTime) : null;
          if (isValidDate(new Date(txTime)) && (!walletTime || new Date(txTime) > new Date(walletTime))) {
            wallet.latestBlockTime = tx.block_time;
          }
        };
        const filteredIncoming = filterType === 'all' || filterType === 'incoming'
          ? incomingData.filter((tx) => tx.address.toLowerCase() !== rootLower && tx.type === 'incoming')
          : [];
        const filteredOutgoing = filterType === 'all' || filterType === 'outgoing'
          ? outgoingData.filter((tx) => tx.address.toLowerCase() !== rootLower && tx.type === 'outgoing')
          : [];
        filteredIncoming.forEach((tx) => addWallet(tx.address, tx, 'incoming', 2));
        filteredOutgoing.forEach((tx) => addWallet(tx.address, tx, 'outgoing', 2));
        const filteredLayer3 = layer3Data.filter((tx) => tx.nametag && tx.nametag !== 'Unknown');
        filteredLayer3.forEach((tx) => {
          const address = tx.type === 'incoming' ? tx.address : tx.address;
          addWallet(address, tx, tx.type, 3);
        });
        const nodes = Array.from(walletMap.values()).map((wallet) => ({
          data: {
            id: wallet.address,
            label: wallet.nametag,
            image: wallet.image,
            chainLogo: wallet.chainLogo,
            tokenSymbol: wallet.tokenSymbol,
            totalValue: wallet.totalValue.toFixed(6),
            txCount: wallet.txCount,
            latestBlockTime: wallet.latestBlockTime,
            type: wallet.type,
            layer: wallet.layer,
            isRoot: wallet.address === rootLower,
          },
        }));
        filteredIncoming.forEach((tx, index) => {
          if (walletMap.has(tx.address.toLowerCase()) && walletMap.has(rootLower)) {
            edges.push({
              data: {
                id: \`in-edge-\${page}-\${index}-\${tx.hash}\`,
                source: tx.address.toLowerCase(),
                target: rootLower,
                value: Number(tx.value).toFixed(6),
                usdValue: Number(tx.usdValue || 0).toFixed(6),
                type: 'incoming',
                txHash: tx.hash,
                block_time: tx.block_time,
                tokenSymbol: tx.tokenSymbol,
                contractAddress: tx.contractAddress,
                tokenImage: tx.tokenImage,
                layer: 2,
              },
            });
          }
        });
        filteredOutgoing.forEach((tx, index) => {
          if (walletMap.has(rootLower) && walletMap.has(tx.address.toLowerCase())) {
            edges.push({
              data: {
                id: \`out-edge-\${page}-\${index}-\${tx.hash}\`,
                source: rootLower,
                target: tx.address.toLowerCase(),
                value: Number(tx.value).toFixed(6),
                usdValue: Number(tx.usdValue || 0).toFixed(6),
                type: 'outgoing',
                txHash: tx.hash,
                block_time: tx.block_time,
                tokenSymbol: tx.tokenSymbol,
                contractAddress: tx.contractAddress,
                tokenImage: tx.tokenImage,
                layer: 2,
              },
            });
          }
        });
        filteredLayer3.forEach((tx, index) => {
          const layer2Address = tx.layer2Address.toLowerCase();
          const layer3Address = tx.address.toLowerCase();
          if (walletMap.has(layer2Address) && walletMap.has(layer3Address)) {
            edges.push({
              data: {
                id: \`layer3-edge-\${page}-\${index}-\${tx.hash}\`,
                source: tx.type === 'incoming' ? layer3Address : layer2Address,
                target: tx.type === 'incoming' ? layer2Address : layer3Address,
                value: Number(tx.value).toFixed(6),
                usdValue: Number(tx.usdValue || 0).toFixed(6),
                type: tx.type,
                txHash: tx.hash,
                block_time: tx.block_time,
                tokenSymbol: tx.tokenSymbol,
                contractAddress: tx.contractAddress,
                tokenImage: tx.tokenImage,
                layer: 3,
              },
            });
          }
        });
        return { nodes, edges, nametags };
      };
      self.onmessage = (e) => {
        const { incomingData, outgoingData, layer3Data, rootAddress, page, filterType } = e.data;
        const result = aggregateWallets(incomingData, outgoingData, layer3Data, rootAddress, page, filterType);
        self.postMessage(result);
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));
    worker.postMessage({ incomingData, outgoingData, layer3Data, rootAddress, page, filterType });
    worker.onmessage = (e) => {
      resolve(e.data);
      worker.terminate();
    };
    worker.onerror = (err) => {
      reject(err);
      worker.terminate();
    };
  });
}