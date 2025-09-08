// utils/clustering.js
import clustering from 'density-clustering';

export function detectClusters(wallets, transactions) {
  const dataset = wallets.map((_, index) => [index]);

  const eps = 2;
  const minPts = 2;

  const dbscan = new clustering.DBSCAN();
  const clusterIndices = dbscan.run(dataset, eps, minPts);

  const clusters = [];
  clusterIndices.forEach((clusterId, index) => {
    if (clusterId === -1) return;
    let cluster = clusters.find((c) => c.clusterId === clusterId);
    if (!cluster) {
      cluster = { clusterId, wallets: [], nametag: 'Unknown', transactions: [] };
      clusters.push(cluster);
    }
    cluster.wallets.push(wallets[index]);

    const walletAddress = wallets[index].id.toLowerCase();
    const relatedTxs = transactions.filter(
      (tx) => tx.source.toLowerCase() === walletAddress || tx.target.toLowerCase() === walletAddress
    );
    cluster.transactions.push(...relatedTxs);
  });

  clusters.forEach((cluster) => {
    const sortedWallets = cluster.wallets.sort((a, b) => b.txCount - a.txCount);
    const prominentWallet = sortedWallets.find((w) => w.label !== 'Unknown') || sortedWallets[0];
    cluster.nametag = prominentWallet ? prominentWallet.label : `Cluster ${cluster.clusterId}`;
  });

  return clusters;
}