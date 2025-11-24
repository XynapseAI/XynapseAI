// utils/dashboardWorker.js

export function dashboardInWorker(cluster) {
  return new Promise((resolve, reject) => {
    const workerCode = `
      const formatLargeNumber = (value, decimals = 1) => {
        const absValue = Math.abs(value);
        if (absValue >= 1e9) return \`\${Number((value / 1e9).toFixed(decimals))}B\`;
        if (absValue >= 1e6) return \`\${Number((value / 1e6).toFixed(decimals))}M\`;
        if (absValue >= 1e3) return \`\${Number((value / 1e3).toFixed(decimals))}K\`;
        return Number(value.toFixed(decimals)).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      };
      const computeDashboard = (cluster) => {
        const totalValue = cluster.wallets.reduce((sum, w) => sum + parseFloat(w.totalValue || 0), 0);
        const txCount = cluster.transactions.length;
        const avgTxValue = txCount > 0 ? totalValue / txCount : 0;
        const times = cluster.transactions.map(tx => {
          const bt = typeof tx.block_time === 'number' ? tx.block_time * 1000 : new Date(tx.block_time).getTime();
          return bt;
        }).filter(t => t).sort((a, b) => a - b);
        let velocity = 0;
        if (times.length > 1) {
          const spanDays = (times[times.length - 1] - times[0]) / (86400000);
          velocity = times.length / Math.max(spanDays, 1);
        }
        const uniqueTokens = new Set(cluster.transactions.map(tx => tx.contractAddress?.toLowerCase() || tx.tokenSymbol?.toLowerCase() || 'unknown')).size;
        const volumes = cluster.transactions.reduce((acc, tx) => {
          const key = tx.contractAddress?.toLowerCase() || (tx.tokenSymbol?.toLowerCase() || 'unknown');
          acc[key] = (acc[key] || 0) + Number(tx.usdValue || tx.value || 0);
          return acc;
        }, {});
        const topTokensVolume = Object.entries(volumes)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5);
        const values = cluster.transactions.map(tx => Number(tx.usdValue || tx.value || 0));
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
        const std = Math.sqrt(variance);
        const threshold = mean + 2 * std;
        const outstandingTxs = cluster.transactions
          .filter(tx => (Number(tx.usdValue || tx.value || 0) > threshold) || (Number(tx.usdValue || tx.value || 0) > totalValue * 0.1))
          .sort((a, b) => (Number(b.usdValue || b.value || 0)) - (Number(a.usdValue || a.value || 0)))
          .slice(0, 3);
        return {
          ...cluster,
          velocity,
          uniqueTokens,
          topTokensVolume,
          outstandingTxs
        };
      };
      self.onmessage = (e) => {
        const { cluster } = e.data;
        const result = computeDashboard(cluster);
        self.postMessage(result);
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));
    worker.postMessage({ cluster });
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