// utils/clusterWorker.js

function truncateAddress(addr) {
  if (!addr) return 'N/A';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function simpleRuleBasedClustering(nodesData, edgesData) {
  const clusters = [];
  const nodeMap = new Map(nodesData.map(n => [n.id.toLowerCase(), n]));
  const adjList = new Map();
  nodesData.forEach(n => adjList.set(n.id.toLowerCase(), new Set()));
  edgesData.forEach(e => {
    adjList.get(e.source.toLowerCase())?.add(e.target.toLowerCase());
    adjList.get(e.target.toLowerCase())?.add(e.source.toLowerCase());
  });
  // Compute per-node metrics for better labeling
  nodesData.forEach(node => {
    const nodeTxs = edgesData.filter(e => e.source.toLowerCase() === node.id.toLowerCase() || e.target.toLowerCase() === node.id.toLowerCase());
    node.degree = adjList.get(node.id.toLowerCase())?.size || 0;
    node.txCount = node.txCount || nodeTxs.length;
    const times = nodeTxs.map(e => typeof e.block_time === 'number' ? e.block_time * 1000 : new Date(e.block_time).getTime()).filter(t => t).sort((a, b) => a - b);
    let velocity = 0;
    if (times.length > 1) {
      const spanDays = (times[times.length - 1] - times[0]) / (86400000);
      velocity = times.length / Math.max(spanDays, 1);
    }
    node.velocity = velocity;
    const uniqueTokens = new Set(nodeTxs.map(e => e.tokenSymbol || 'unknown')).size;
    node.uniqueTokens = uniqueTokens;
    // Enhanced rule-based autoLabel - Only assign for Institution, Whale, Exchange, NFT Collector
    let autoLabel = null;
    const totalValue = parseFloat(node.totalValue || 0);
    const txCount = node.txCount || 0;
    const degree = node.degree || 0;
    if (degree > 20 || txCount > 500) autoLabel = 'Exchange';
    else if (totalValue > 1000000) autoLabel = 'Whale';
    else if (totalValue > 100000 && degree > 8 && velocity < 1.5) autoLabel = 'Institution';
    else if (uniqueTokens >= 30) autoLabel = 'NFT Collector';
    node.autoLabel = autoLabel;
  });
  // Simple: Group by shared label (nametag) or high degree (>3), add auto-label preview only if applicable
  const groups = new Map();
  nodesData.forEach(node => {
    const key = node.label !== 'Unknown' ? node.label : (node.autoLabel ? `auto_${node.autoLabel}_${node.degree > 3 ? 'hub' : 'solo'}` : truncateAddress(node.id));
    if (!groups.has(key)) groups.set(key, { wallets: [], transactions: [], autoLabel: node.autoLabel });
    groups.get(key).wallets.push({ ...node, autoLabel: node.autoLabel }); // Add to node
  });
  // Assign tx (simple: all to group if connected)
  edgesData.forEach(edge => {
    const sourceKey = [...groups.entries()].find(([k, g]) => g.wallets.some(w => w.id.toLowerCase() === edge.source.toLowerCase()))?.[0];
    if (sourceKey) groups.get(sourceKey).transactions.push({ ...edge });
  });
  groups.forEach((group, key) => {
    if (group.wallets.length >= 2 && group.wallets.some(w => w.label !== 'Unknown' || w.autoLabel)) {
      clusters.push({
        clusterId: key,
        nametag: key,
        wallets: group.wallets,
        transactions: [...new Set(group.transactions.map(JSON.stringify))].map(JSON.parse),
        riskScore: 0.3, // Default low
        velocity: 0,
        uniqueTokens: 0,
        topFeatures: [], // Empty
        autoLabel: group.autoLabel || null, // Preview only if applicable
      });
    }
  });
  return clusters;
}

export function clusterInWorker(nodes, edges) {
  return new Promise((resolve, reject) => {
    const workerCode = `
      function truncateAddress(addr) {
        if (!addr) return 'N/A';
        return \`\${addr.slice(0, 6)}...\${addr.slice(-4)}\`;
      }

      function simpleRuleBasedClustering(nodesData, edgesData) {
        const clusters = [];
        const nodeMap = new Map(nodesData.map(n => [n.id.toLowerCase(), n]));
        const adjList = new Map();
        nodesData.forEach(n => adjList.set(n.id.toLowerCase(), new Set()));
        edgesData.forEach(e => {
          adjList.get(e.source.toLowerCase())?.add(e.target.toLowerCase());
          adjList.get(e.target.toLowerCase())?.add(e.source.toLowerCase());
        });
        // Compute per-node metrics for better labeling
        nodesData.forEach(node => {
          const nodeTxs = edgesData.filter(e => e.source.toLowerCase() === node.id.toLowerCase() || e.target.toLowerCase() === node.id.toLowerCase());
          node.degree = adjList.get(node.id.toLowerCase())?.size || 0;
          node.txCount = node.txCount || nodeTxs.length;
          const times = nodeTxs.map(e => typeof e.block_time === 'number' ? e.block_time * 1000 : new Date(e.block_time).getTime()).filter(t => t).sort((a, b) => a - b);
          let velocity = 0;
          if (times.length > 1) {
            const spanDays = (times[times.length - 1] - times[0]) / (86400000);
            velocity = times.length / Math.max(spanDays, 1);
          }
          node.velocity = velocity;
          const uniqueTokens = new Set(nodeTxs.map(e => e.tokenSymbol || 'unknown')).size;
          node.uniqueTokens = uniqueTokens;
          // Enhanced rule-based autoLabel - Only assign for Institution, Whale, Exchange, NFT Collector
          let autoLabel = null;
          const totalValue = parseFloat(node.totalValue || 0);
          const txCount = node.txCount || 0;
          const degree = node.degree || 0;
          if (degree > 20 || txCount > 500) autoLabel = 'Exchange';
          else if (totalValue > 1000000) autoLabel = 'Whale';
          else if (totalValue > 100000 && degree > 8 && velocity < 1.5) autoLabel = 'Institution';
          else if (uniqueTokens >= 30) autoLabel = 'NFT Collector';
          node.autoLabel = autoLabel;
        });
        // Simple: Group by shared label (nametag) or high degree (>3), add auto-label preview only if applicable
        const groups = new Map();
        nodesData.forEach(node => {
          const key = node.label !== 'Unknown' ? node.label : (node.autoLabel ? \`auto_\${node.autoLabel}_\${node.degree > 3 ? 'hub' : 'solo'}\` : truncateAddress(node.id));
          if (!groups.has(key)) groups.set(key, { wallets: [], transactions: [], autoLabel: node.autoLabel });
          groups.get(key).wallets.push({ ...node, autoLabel: node.autoLabel }); // Add to node
        });
        // Assign tx (simple: all to group if connected)
        edgesData.forEach(edge => {
          const sourceKey = [...groups.entries()].find(([k, g]) => g.wallets.some(w => w.id.toLowerCase() === edge.source.toLowerCase()))?.[0];
          if (sourceKey) groups.get(sourceKey).transactions.push({ ...edge });
        });
        groups.forEach((group, key) => {
          if (group.wallets.length >= 2 && group.wallets.some(w => w.label !== 'Unknown' || w.autoLabel)) {
            clusters.push({
              clusterId: key,
              nametag: key,
              wallets: group.wallets,
              transactions: [...new Set(group.transactions.map(JSON.stringify))].map(JSON.parse),
              riskScore: 0.3, // Default low
              velocity: 0,
              uniqueTokens: 0,
              topFeatures: [], // Empty
              autoLabel: group.autoLabel || null, // Preview only if applicable
            });
          }
        });
        return clusters;
      }

      if (typeof self !== 'undefined' && self instanceof WorkerGlobalScope) {
        self.onmessage = async (e) => {
          const { nodes, edges } = e.data;
          try {
            const clusters = simpleRuleBasedClustering(nodes, edges);
            self.postMessage({ clusters });
          } catch (err) {
            self.postMessage({ error: err.message });
          }
        };
      }
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));
    worker.postMessage({ nodes, edges });
    worker.onmessage = (e) => {
      if (e.data.error) {
        reject(new Error(e.data.error));
      } else {
        resolve(e.data.clusters);
      }
      worker.terminate();
    };
    worker.onerror = (err) => {
      reject(err);
      worker.terminate();
    };
  });
}