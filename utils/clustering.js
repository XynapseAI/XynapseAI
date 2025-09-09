// utils/clustering.js
import clustering from 'density-clustering';
import { logger } from './clientLogger';

export function detectClusters(wallets, transactions) {
  // Tạo dataset dựa trên đặc điểm thực tế của ví
  const dataset = wallets.map((wallet) => [
    wallet.totalValue || 0, // Giá trị giao dịch tổng cộng
    wallet.txCount || 0,    // Số lượng giao dịch
  ]);

  // Tham số DBSCAN: eps và minPts được điều chỉnh để phù hợp hơn
  const eps = 100000; // Khoảng cách tối đa để coi là cùng cụm, điều chỉnh dựa trên dữ liệu
  const minPts = 1;   // Số lượng điểm tối thiểu để tạo cụm, giảm xuống 1 để đảm bảo node gốc có cụm

  const dbscan = new clustering.DBSCAN();
  const clusterIndices = dbscan.run(dataset, eps, minPts);

  const clusters = [];
  const noiseWallets = []; // Lưu các ví bị coi là nhiễu

  // Xử lý các ví được gán cụm
  clusterIndices.forEach((clusterId, index) => {
    if (clusterId === -1) {
      // Lưu ví nhiễu để xử lý sau
      noiseWallets.push(wallets[index]);
      return;
    }

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

  // Xử lý ví nhiễu: Tạo cụm riêng cho từng ví nhiễu, đặc biệt là node gốc
  noiseWallets.forEach((wallet) => {
    const isRoot = wallet.isRoot || false;
    const clusterId = clusters.length;
    const cluster = {
      clusterId,
      wallets: [wallet],
      nametag: wallet.label !== 'Unknown' ? wallet.label : `Cluster ${clusterId}`,
      transactions: transactions.filter(
        (tx) => tx.source.toLowerCase() === wallet.id.toLowerCase() || tx.target.toLowerCase() === wallet.id.toLowerCase()
      ),
    };
    clusters.push(cluster);
    if (isRoot) {
      logger.info(`Root node ${wallet.id} assigned to new cluster ${clusterId} with nametag ${cluster.nametag}`);
    }
  });

  // Gán nametag cho các cụm
  clusters.forEach((cluster) => {
    // Kiểm tra xem cụm có chứa node gốc không
    const rootWallet = cluster.wallets.find((w) => w.isRoot);
    if (rootWallet && rootWallet.label !== 'Unknown') {
      // Ưu tiên sử dụng nametag của node gốc
      cluster.nametag = rootWallet.label;
      logger.info(`Cluster ${cluster.clusterId} assigned nametag from root node: ${cluster.nametag}`);
    } else {
      // Nếu không có node gốc, chọn ví nổi bật (có label khác Unknown hoặc txCount cao nhất)
      const sortedWallets = cluster.wallets.sort((a, b) => b.txCount - a.txCount);
      const prominentWallet = sortedWallets.find((w) => w.label !== 'Unknown') || sortedWallets[0];
      cluster.nametag = prominentWallet ? prominentWallet.label : `Cluster ${cluster.clusterId}`;
    }
  });

  logger.info('Clusters detected:', clusters.map((c) => ({
    clusterId: c.clusterId,
    nametag: c.nametag,
    walletCount: c.wallets.length,
    isRootIncluded: !!c.wallets.find((w) => w.isRoot),
  })));

  return clusters;
}