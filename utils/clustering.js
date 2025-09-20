// utils/clustering.js
import { logger } from './clientLogger';

// Dynamic import for TensorFlow.js to avoid SSR issues
let tf = null;
const loadTensorFlow = async () => {
  if (!tf) {
    const tfCore = await import('@tensorflow/tfjs-core');
    await import('@tensorflow/tfjs-backend-cpu');
    tf = tfCore;
    await tf.setBackend('cpu');
    await tf.ready();
  }
  return tf;
};

export async function detectClusters(nodes, edges, options = { useML: true, useDBSCAN: true, useGNN: true }) {
  const clusters = [];
  const nodeMap = new Map();
  const edgeMap = new Map();
  const adjacencyList = new Map();

  // Initialize adjacency list
  const clusterableNodes = nodes.filter(
    (node) => !node.isRoot && (node.layer === 2 || node.layer === 3) && node.label !== 'Unknown'
  );
  nodes.forEach((node) => {
    nodeMap.set(node.id.toLowerCase(), node);
    adjacencyList.set(node.id.toLowerCase(), new Set());
  });

  // Build adjacency list from edges
  edges.forEach((edge) => {
    const source = edge.source.toLowerCase();
    const target = edge.target.toLowerCase();
    edgeMap.set(edge.id, edge);
    if (adjacencyList.has(source) && adjacencyList.has(target)) {
      adjacencyList.get(source).add(target);
      adjacencyList.get(target).add(source);
    }
  });

  let communities = new Map();

  // ML clustering logic giữ nguyên
  if (options.useML && clusterableNodes.length > 1) {
    try {
      const tf = await loadTensorFlow();
      const now = Date.now();
      const features = [];
      const nodeIds = [];

      clusterableNodes.forEach((node) => {
        const degree = adjacencyList.get(node.id.toLowerCase())?.size || 0;
        const avgValue = node.totalValue / Math.max(node.txCount, 1);
        const latestTime = node.latestBlockTime
          ? typeof node.latestBlockTime === 'number'
            ? node.latestBlockTime
            : new Date(node.latestBlockTime).getTime()
          : now;
        const daysSince = (now - latestTime) / (1000 * 60 * 60 * 24);
        const hasLabel = node.label !== 'Unknown' ? 1 : 0;

        const feat = [
          Math.log1p(parseFloat(node.totalValue) || 0),
          Math.log1p(node.txCount || 0),
          degree,
          Math.log1p(avgValue || 0),
          Math.min(daysSince, 365),
          hasLabel,
        ];
        features.push(feat);
        nodeIds.push(node.id.toLowerCase());
      });

      if (features.length < 2) {
        throw new Error('Insufficient nodes for ML clustering');
      }

      let embeddings = tf.tensor2d(features);

      if (options.useGNN) {
        try {
          const n = features.length;
          const adj = tf.zeros([n, n]);
          nodeIds.forEach((id, i) => {
            adjacencyList.get(id)?.forEach((neighId) => {
              const j = nodeIds.indexOf(neighId.toLowerCase());
              if (j !== -1) adj.assign(1, [i, j], [1, 1]);
            });
          });

          const w = tf.randomNormal([features[0].length, 16]);
          const wx = tf.matMul(embeddings, w);
          const h = tf.tanh(tf.matMul(adj, wx));
          embeddings = h;
          logger.log('GNN embeddings generated');
        } catch (gnnErr) {
          logger.warn('GNN failed, using raw features:', gnnErr.message);
        }
      }

      const mean = tf.mean(embeddings, 0, true);
      const std = tf.sqrt(tf.variance(embeddings, 0, true));
      const normalized = embeddings.sub(mean).div(std.add(1e-8));

      if (options.useDBSCAN) {
        const labels = dbscan(normalized.arraySync(), 0.5, 2);
        nodeIds.forEach((id, idx) => {
          if (labels[idx] !== -1) {
            communities.set(id, labels[idx]);
          }
        });
        logger.log(`DBSCAN clustering completed: ${new Set(labels.filter(l => l !== -1)).size} clusters`);
      } else {
        // Fallback to KMeans
        const n = features.length;
        const d = features[0].length;
        const k = Math.max(2, Math.floor(Math.sqrt(n)));
        let centroids = tf.randomNormal([k, d]).mul(0.1).add(tf.mean(normalized, 0));
        const maxIter = 50;
        let assignments = new Array(n).fill(0);

        for (let iter = 0; iter < maxIter; iter++) {
          const dist = tf.tidy(() => {
            const XX = tf.sum(tf.pow(normalized, 2), 1, true);
            const CC = tf.sum(tf.pow(centroids, 2), 1, false);
            const XC = tf.matMul(normalized, centroids, false, true);
            return XX.add(CC).sub(tf.mul(XC, 2));
          });

          const newAssignments = tf.argMin(dist, 1).arraySync();
          dist.dispose();

          if (JSON.stringify(newAssignments) === JSON.stringify(assignments)) {
            break;
          }
          assignments = newAssignments;

          // Update centroids
          const sums = tf.zeros([k, d]);
          const counts = new Array(k).fill(0);
          for (let i = 0; i < n; i++) {
            const c = assignments[i];
            counts[c]++;
            const row = normalized.slice([i, 0], [1, d]);
            sums.assign(sums.slice([c, 0], [1, d]).add(row));
            row.dispose();
          }
          const validCounts = tf.tensor1d(counts).add(1e-8);
          centroids.dispose();
          centroids = sums.div(validCounts.expandDims(1));
          sums.dispose();
          validCounts.dispose();
        }

        nodeIds.forEach((id, idx) => {
          communities.set(id, assignments[idx]);
        });

        centroids.dispose();
        logger.log(`KMeans clustering completed: ${k} clusters for ${n} nodes`);
      }

      // Dispose tensors
      normalized.dispose();
      mean.dispose();
      std.dispose();
      embeddings.dispose();
    } catch (err) {
      logger.warn('ML clustering failed, falling back to Louvain:', err.message);
      options.useML = false;
    }
  }

  if (!options.useML) {
    // Fallback Louvain clustering
    communities = new Map();
    let clusterId = 0;
    nodes.forEach((node) => {
      communities.set(node.id, clusterId++);
    });

    let changed = true;
    let iterations = 0;
    const maxIterations = 10;

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      for (const nodeId of nodes.map((n) => n.id)) {
        const currentCommunity = communities.get(nodeId);
        const neighborCommunities = new Map();

        adjacencyList.get(nodeId)?.forEach((neighborId) => {
          const neighborCommunity = communities.get(neighborId);
          neighborCommunities.set(neighborCommunity, (neighborCommunities.get(neighborCommunity) || 0) + 1);
        });

        let bestCommunity = currentCommunity;
        let maxConnections = neighborCommunities.get(currentCommunity) || 0;

        for (const [commId, count] of neighborCommunities) {
          if (count > maxConnections) {
            maxConnections = count;
            bestCommunity = commId;
          }
        }

        if (bestCommunity !== currentCommunity) {
          communities.set(nodeId, bestCommunity);
          changed = true;
        }
      }
    }
  }

  // New: Risk analysis
  const calculateRiskScore = (node) => {
    const valueScore = parseFloat(node.totalValue) > 1000 ? 0.3 : 0;
    const txScore = node.txCount < 5 ? 0.3 : 0;
    const timeScore = node.latestBlockTime
      ? (Date.now() - new Date(node.latestBlockTime).getTime()) / (1000 * 60 * 60 * 24 * 30) > 6
        ? 0.4
        : 0
      : 0;
    return Math.min(1, valueScore + txScore + timeScore);
  };

  // Group nodes by community
  const communityGroups = new Map();
  for (const [nodeId, commId] of communities) {
    if (!communityGroups.has(commId)) {
      communityGroups.set(commId, { wallets: [], transactions: [] });
    }
    const node = nodeMap.get(nodeId.toLowerCase());
    if (node) {
      communityGroups.get(commId).wallets.push(node);
    }
  }

  // Assign transactions to clusters
  edges.forEach((edge) => {
    const source = edge.source.toLowerCase();
    const target = edge.target.toLowerCase();
    const sourceComm = communities.get(source);
    const targetComm = communities.get(target);
    if (
      sourceComm !== undefined &&
      targetComm !== undefined &&
      sourceComm === targetComm &&
      communityGroups.has(sourceComm)
    ) {
      const txData = {
        id: edge.id,
        source,
        target,
        type: edge.type,
        value: edge.value,
        txHash: edge.txHash,
        block_time: edge.block_time,
        tokenSymbol: edge.tokenSymbol,
        contractAddress: edge.contractAddress?.toLowerCase(),
        tokenImage: edge.tokenImage,
        layer: edge.layer,
      };
      communityGroups.get(sourceComm).transactions.push(txData);
    }
  });

  // Create cluster objects
  communityGroups.forEach((group, commId) => {
    const hasValidNametag = group.wallets.some(
      (wallet) => (wallet.layer === 2 || wallet.layer === 3) && wallet.label !== 'Unknown'
    );
    if (!hasValidNametag || group.wallets.length < 2) return;

    let clusterNametag = 'Unknown Cluster';
    const layer3Node = group.wallets.find((w) => w.layer === 3 && w.label !== 'Unknown');
    const layer2Node = group.wallets.find((w) => w.layer === 2 && w.label !== 'Unknown');
    if (layer3Node) {
      clusterNametag = layer3Node.label;
    } else if (layer2Node) {
      clusterNametag = layer2Node.label;
    }

    const clusterRisk = Math.max(...group.wallets.map((w) => calculateRiskScore(w)));
    const uniqueTxs = [...new Set(group.transactions.map(JSON.stringify))].map(JSON.parse);
    logger.log(`Cluster ${commId}:`, {
      nametag: clusterNametag,
      walletCount: group.wallets.length,
      transactionCount: uniqueTxs.length,
      wallets: group.wallets.map(w => w.id),
      transactions: uniqueTxs.map(tx => tx.id),
    });
    clusters.push({
      clusterId: commId,
      nametag: clusterNametag,
      wallets: group.wallets,
      transactions: uniqueTxs,
      riskScore: clusterRisk,
    });
  });

  clusters.sort((a, b) =>
    b.wallets.reduce((sum, w) => sum + parseFloat(w.totalValue), 0) -
    a.wallets.reduce((sum, w) => sum + parseFloat(w.totalValue), 0)
  );

  logger.log(`Detected ${clusters.length} enhanced clusters with risk analysis`);
  return clusters;
}

// New: Vanilla DBSCAN implementation
function dbscan(data, eps, minPts) {
  const n = data.length;
  const labels = new Array(n).fill(-2); // -2 unvisited, -1 noise
  let clusterId = 0;

  const dist = (p1, p2) => Math.sqrt(p1.reduce((sum, val, i) => sum + (val - p2[i]) ** 2, 0)); // Euclidean

  const regionQuery = (pIdx) => {
    const neighbors = [];
    for (let i = 0; i < n; i++) {
      if (i !== pIdx && dist(data[pIdx], data[i]) < eps) {
        neighbors.push(i);
      }
    }
    return neighbors;
  };

  const expandCluster = (pIdx, neighbors) => {
    labels[pIdx] = clusterId;
    let i = 0;
    while (i < neighbors.length) {
      const qIdx = neighbors[i];
      if (labels[qIdx] === -1) labels[qIdx] = clusterId;
      if (labels[qIdx] === -2) {
        labels[qIdx] = clusterId;
        const newNeighbors = regionQuery(qIdx);
        if (newNeighbors.length >= minPts) {
          neighbors.push(...newNeighbors);
        }
      }
      i++;
    }
  };

  for (let i = 0; i < n; i++) {
    if (labels[i] !== -2) continue;
    const neighbors = regionQuery(i);
    if (neighbors.length < minPts) {
      labels[i] = -1;
    } else {
      expandCluster(i, neighbors);
      clusterId++;
    }
  }

  return labels;
}