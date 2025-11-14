// utils/serverClustering.js
// Fully dynamic: No static imports. All TF.js loaded at runtime inside function.
// This avoids Next.js bundling conflicts with native deps like tfjs-node.
// Fallback: Pure JS tfjs if native fails.

import { logger } from './serverLogger'; // Optional; fallback to console

// No static TF import – all dynamic in function

// DBSCAN (pure JS, no TF)
function dbscan(data, eps, minPts) {
  const n = data.length;
  const labels = new Array(n).fill(-2);
  let clusterId = 0;
  const dist = (p1, p2) => Math.sqrt(p1.reduce((sum, val, i) => sum + (val - p2[i]) ** 2, 0));
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

// Modularity (pure JS)
function calculateModularity(assignments, adjacencyList, nodeIds) {
  const n = nodeIds.length;
  let m = 0;
  const adjMatrix = {};
  nodeIds.forEach((id) => adjMatrix[id] = new Set(adjacencyList.get(id)));
  nodeIds.forEach((id1) => {
    adjMatrix[id1].forEach((id2) => {
      if (id1 < id2) m++;
    });
  });
  m *= 2;
  let mod = 0;
  const communityEdges = new Map();
  const communityDeg = new Map();
  assignments.forEach((comm, i) => {
    const id = nodeIds[i];
    const deg = adjMatrix[id]?.size || 0;
    communityDeg.set(comm, (communityDeg.get(comm) || 0) + deg);
    adjMatrix[id]?.forEach((neighId) => {
      const neighComm = assignments[nodeIds.indexOf(neighId)];
      if (comm === neighComm) {
        const key = `${Math.min(comm, neighComm)}-${Math.max(comm, neighComm)}`;
        communityEdges.set(key, (communityEdges.get(key) || 0) + 1);
      }
    });
  });
  communityEdges.forEach((e, key) => {
    const [c1, c2] = key.split('-').map(Number);
    if (c1 === c2) {
      mod += (2 * e / m) - Math.pow(communityDeg.get(c1) / m, 2);
    }
  });
  return mod;
}

// Louvain (pure JS)
function louvainClustering(clusterableNodes, adjacencyList, edges) {
  const communities = new Map();
  let clusterId = 0;
  clusterableNodes.forEach((node) => communities.set(node.id.toLowerCase(), clusterId++));
  let changed = true;
  let iterations = 0;
  const maxIterations = 50;
  const totalEdges = edges.length * 2;
  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;
    for (const nodeId of clusterableNodes.map(n => n.id.toLowerCase())) {
      const currentCommunity = communities.get(nodeId);
      const neighborCommunities = new Map();
      const deg = adjacencyList.get(nodeId)?.size || 0;
      adjacencyList.get(nodeId)?.forEach((neighborId) => {
        const neighborCommunity = communities.get(neighborId);
        const count = (neighborCommunities.get(neighborCommunity) || 0) + 1;
        neighborCommunities.set(neighborCommunity, count);
      });
      let bestCommunity = currentCommunity;
      let maxDeltaQ = 0;
      for (const [commId, count] of neighborCommunities) {
        const commSize = 0; // Simplified
        const deltaQ = (1.0 / totalEdges) * (count - (deg / totalEdges) * commSize) - (deg / totalEdges) * (deg / totalEdges);
        if (deltaQ > maxDeltaQ) {
          maxDeltaQ = deltaQ;
          bestCommunity = commId;
        }
      }
      if (bestCommunity !== currentCommunity && maxDeltaQ > 0.01) {
        communities.set(nodeId, bestCommunity);
        changed = true;
      }
    }
  }
  return communities;
}

// Isolation Forest (dynamic TF inside)
async function isolationForestAnomaly(allNodes, nodeIdx, tf) {
  if (allNodes.length <= 1) return 0;
  const n = allNodes.length;
  const trees = 10;
  let avgPath = 0;
  try {
    const featMatrix = tf.tensor2d(allNodes.map(n => [
      Math.log1p(parseFloat(n.totalValue) || 0),
      Math.log1p(parseFloat(n.txCount) || 0),
      (n.degree || 0)
    ]));

    for (let t = 0; t < trees; t++) {
      let pathLen = 0;
      let current = featMatrix.clone();
      let currIdx = nodeIdx;
      for (let depth = 0; depth < Math.log2(n); depth++) {
        const splitFeat = Math.floor(Math.random() * 3);
        const splitVal = tf.tidy(() => tf.mean(current.gather(splitFeat, 1), 0).dataSync()[0]);
        const nodeVal = current.gather([currIdx], 0).gather([splitFeat], 1).dataSync()[0];
        pathLen++;
        if (pathLen >= n - 1) break;
      }
      avgPath += pathLen;
      current.dispose();
    }
    featMatrix.dispose();
    const anomalyScore = 2 ** (-avgPath / trees / Math.log2(n + 1e-8));
    return Math.min(1, anomalyScore);
  } catch (ifErr) {
    logger.warn('Isolation Forest failed (heuristic fallback):', ifErr.message);
    return 0.5;
  }
}

// Main function: Fully dynamic TF load here
export async function detectClustersServer(nodes, edges, options = { useML: true, useDBSCAN: true, useGNN: true }, tfInstance = null) {
  // Dynamic load TF if not provided
  let tf;
  if (!tfInstance) {
    try {
      const tfNodePkg = '@tensorflow/tfjs-n' + 'ode';  // <-- Concat to bypass Webpack
      const tfModule = await import(tfNodePkg);
      tf = tfModule;
      await tf.setBackend('cpu');
      await tf.ready();
      logger.log('Dynamic tfjs-node loaded in clustering');
    } catch (nativeErr) {
      logger.warn('Dynamic tfjs-node failed, pure JS:', nativeErr.message);
      const pureTfPkg = '@tensorflow/tf' + 'js';  // <-- Concat to bypass Webpack
      const pureTf = await import(pureTfPkg);
      tf = pureTf;
      await tf.setBackend('cpu');
      await tf.ready();
      options.useGNN = false; // Lighter in pure JS
    }
  } else {
    tf = tfInstance;
  }

  if (!tf) {
    throw new Error('TensorFlow.js load failed');
  }

  const clusters = [];
  const nodeMap = new Map();
  const adjacencyList = new Map();

  const clusterableNodes = nodes.filter(
    (node) => !node.isRoot && (node.layer === 2 || node.layer === 3) && node.label !== 'Unknown'
  );

  nodes.forEach((node) => {
    nodeMap.set(node.id.toLowerCase(), node);
    adjacencyList.set(node.id.toLowerCase(), new Set());
  });

  edges.forEach((edge) => {
    const source = edge.source.toLowerCase();
    const target = edge.target.toLowerCase();
    if (adjacencyList.has(source) && adjacencyList.has(target)) {
      adjacencyList.get(source).add(target);
      adjacencyList.get(target).add(source);
    }
  });

  const now = Date.now();
  clusterableNodes.forEach((node) => {
    const nodeTxs = edges.filter(e => e.source.toLowerCase() === node.id.toLowerCase() || e.target.toLowerCase() === node.id.toLowerCase());
    const times = nodeTxs.map(e => {
      const bt = typeof e.block_time === 'number' ? e.block_time * 1000 : new Date(e.block_time).getTime();
      return bt || now;
    }).sort((a, b) => a - b);
    let burstScore = 0;
    for (let i = 1; i < times.length; i++) {
      const hourDiff = (times[i] - times[i - 1]) / (3600 * 1000);
      if (hourDiff < 1 && hourDiff > 0) burstScore += 1;
    }
    node.burstScore = Math.min(burstScore / Math.max(node.txCount || 1, 1), 1);
    node.degree = adjacencyList.get(node.id.toLowerCase())?.size || 0;
  });

  let communities = new Map();

  if (options.useML && clusterableNodes.length > 1) {
    try {
      const features = [];
      const nodeIds = [];
      clusterableNodes.forEach((node) => {
        const id = node.id.toLowerCase();
        const neighbors = adjacencyList.get(id) || new Set();
        const avgValue = parseFloat(node.totalValue || 0) / Math.max(parseFloat(node.txCount || 1), 1);
        const latestTime = node.latestBlockTime
          ? typeof node.latestBlockTime === 'number'
            ? node.latestBlockTime * 1000
            : new Date(node.latestBlockTime).getTime()
          : now;
        const daysSince = (now - latestTime) / (1000 * 60 * 60 * 24);
        const hasLabel = node.label !== 'Unknown' ? 1 : 0;
        let triangleCount = 0;
        let possibleTriangles = 0;
        const neighArray = Array.from(neighbors).sort();
        for (let i = 0; i < neighArray.length; i++) {
          for (let j = i + 1; j < neighArray.length; j++) {
            possibleTriangles++;
            if (adjacencyList.get(neighArray[i])?.has(neighArray[j])) {
              triangleCount++;
            }
          }
        }
        const clusteringCoeff = possibleTriangles > 0 ? triangleCount / possibleTriangles : 0;
        let neighEntropy = 0;
        if (neighbors.size > 0) {
          const p = 1 / neighbors.size;
          neighEntropy = - (neighbors.size * p * Math.log(p + 1e-10));
        }
        const feat = [
          Math.log1p(parseFloat(node.totalValue || 0)),
          Math.log1p(parseFloat(node.txCount || 0)),
          node.degree,
          Math.log1p(avgValue || 0),
          Math.min(daysSince, 365),
          hasLabel,
          clusteringCoeff,
          neighEntropy,
          node.burstScore
        ];
        features.push(feat);
        nodeIds.push(id);
      });

      if (features.length < 2) {
        throw new Error('Insufficient nodes for ML clustering');
      }

      let embeddings = tf.tensor2d(features);
      const numFeatures = features[0].length;

      // GNN with try-catch
      if (options.useGNN) {
        try {
          const n = features.length;
          const indices = [];
          const values = [];
          nodeIds.forEach((id, i) => {
            adjacencyList.get(id)?.forEach((neighId) => {
              const j = nodeIds.indexOf(neighId.toLowerCase());
              if (j !== -1 && i < j) {
                indices.push([i, j]);
                indices.push([j, i]);
                values.push(1, 1);
              }
            });
          });
          const adjShape = [n, n];
          const adjSparse = tf.sparseTensor(indices.map(([i, j]) => [i, j]), values, adjShape);

          const w1 = tf.randomNormal([numFeatures, 16]);
          let h = tf.tanh(tf.matMul(embeddings, w1));
          const agg1 = tf.tidy(() => tf.sparseDenseMatMul(adjSparse, h).div(tf.tensor1d(Array.from({length: n}, (_, i) => Math.max(adjacencyList.get(nodeIds[i])?.size || 1, 1)))));
          h = tf.tanh(tf.add(h, agg1));

          const w2 = tf.randomNormal([16, 8]);
          h = tf.tanh(tf.matMul(h, w2));
          embeddings = h;

          w1.dispose();
          w2.dispose();
          h.dispose();
          agg1.dispose();
          adjSparse.dispose();
          logger.log('GraphSAGE embeddings generated');
        } catch (gnnErr) {
          logger.warn('GNN failed, using raw features:', gnnErr.message);
        }
      }

      // Normalize
      const mean = tf.mean(embeddings, 0, true);
      const std = tf.sqrt(tf.variance(embeddings, 0, true));
      const normalized = embeddings.sub(mean).div(std.add(1e-8));

      // Clustering
      if (options.useDBSCAN) {
        try {
          const data = normalized.arraySync();
          const distMatrix = tf.tidy(() => {
            const sqDists = tf.sum(tf.pow(normalized.sub(normalized.expandDims(0)), 2), 2);
            return tf.sqrt(sqDists);
          });
          const avgDist = tf.mean(distMatrix).arraySync()[0];
          const eps = Math.max(0.3, Math.min(0.8, avgDist / Math.sqrt(numFeatures)));
          distMatrix.dispose();
          const labels = dbscan(data, eps, Math.max(2, Math.floor(features.length / 10)));
          nodeIds.forEach((id, idx) => {
            if (labels[idx] !== -1) {
              communities.set(id, labels[idx]);
            }
          });
          logger.log(`DBSCAN completed (eps=${eps.toFixed(2)})`);
        } catch (dbErr) {
          logger.warn('DBSCAN failed, fallback KMeans:', dbErr.message);
        }
      }

      if (communities.size === 0) {
        // KMeans fallback
        try {
          const n = features.length;
          let bestK = Math.max(2, Math.floor(Math.sqrt(n)));
          let bestModularity = -Infinity;
          let bestAssignments = null;
          for (let k = 2; k <= Math.min(20, n); k++) {
            let centroids = tf.tidy(() => tf.randomNormal([k, numFeatures]).mul(0.1).add(tf.mean(normalized, 0)));
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
              if (JSON.stringify(newAssignments) === JSON.stringify(assignments)) break;
              assignments = newAssignments;
              const sums = tf.zeros([k, numFeatures]);
              const counts = tf.zeros([k]);
              for (let i = 0; i < n; i++) {
                const c = assignments[i];
                counts.assign(counts.gather([c], 0).add(tf.scalar(1)), [c], [1]);
                const row = normalized.slice([i, 0], [1, -1]);
                sums.assign(sums.slice([c, 0], [1, -1]).add(row), [c, 0], [1, -1]);
                row.dispose();
              }
              const validCounts = counts.add(1e-8);
              centroids = sums.div(validCounts.expandDims(1));
              sums.dispose();
              counts.dispose();
              validCounts.dispose();
            }
            const modularity = calculateModularity(assignments, adjacencyList, nodeIds);
            if (modularity > bestModularity) {
              bestModularity = modularity;
              bestAssignments = [...assignments];
              bestK = k;
            }
            centroids.dispose();
          }
          nodeIds.forEach((id, idx) => {
            communities.set(id, bestAssignments[idx]);
          });
          logger.log(`KMeans completed (k=${bestK})`);
        } catch (kmErr) {
          logger.warn('KMeans failed, fallback Louvain:', kmErr.message);
          communities = louvainClustering(clusterableNodes, adjacencyList, edges);
        }
      }

      normalized.dispose();
      mean.dispose();
      std.dispose();
      embeddings.dispose();
    } catch (mlErr) {
      logger.warn('ML clustering failed, fallback Louvain:', mlErr.message);
      communities = louvainClustering(clusterableNodes, adjacencyList, edges);
    }
  } else {
    communities = louvainClustering(clusterableNodes, adjacencyList, edges);
  }

  // Risk scoring
  const calculateRiskScore = async (node, allNodesInGroup) => {
    const valueScore = parseFloat(node.totalValue || 0) > 1000 ? 0.3 : 0;
    const txScore = parseFloat(node.txCount || 0) < 5 ? 0.3 : 0;
    const timeScore = node.latestBlockTime
      ? (now - new Date(typeof node.latestBlockTime === 'number' ? node.latestBlockTime * 1000 : node.latestBlockTime).getTime()) / (1000 * 60 * 60 * 24 * 30) > 6
        ? 0.4 : 0 : 0.2;
    let anomalyScore = 0;
    try {
      anomalyScore = await isolationForestAnomaly(allNodesInGroup, allNodesInGroup.findIndex(n => n.id.toLowerCase() === node.id.toLowerCase()), tf);
    } catch (ifErr) {
      logger.warn('Anomaly score failed:', ifErr.message);
    }
    const nodeTxs = edges.filter(e => e.source.toLowerCase() === node.id.toLowerCase() || e.target.toLowerCase() === node.id.toLowerCase());
    const roundTrips = nodeTxs.filter(e => Math.abs(parseFloat(e.value || 0) - parseFloat(node.totalValue || 0)) < 0.2 * parseFloat(node.totalValue || 0));
    const ruleScore = roundTrips.length / Math.max(parseFloat(node.txCount || 1), 1);
    return Math.min(1, 0.25 * valueScore + 0.2 * txScore + 0.2 * timeScore + 0.25 * anomalyScore + 0.1 * ruleScore);
  };

  const communityGroups = new Map();
  for (const [nodeId, commId] of communities) {
    if (!communityGroups.has(commId)) {
      communityGroups.set(commId, { wallets: [], transactions: [] });
    }
    const node = nodeMap.get(nodeId);
    if (node) {
      communityGroups.get(commId).wallets.push(node);
    }
  }

  edges.forEach((edge) => {
    const source = edge.source.toLowerCase();
    const target = edge.target.toLowerCase();
    const sourceComm = communities.get(source);
    const targetComm = communities.get(target);
    if (sourceComm === targetComm && communityGroups.has(sourceComm)) {
      const txData = {
        ...edge,
        value: parseFloat(edge.value || 0),
        usdValue: parseFloat(edge.usdValue || 0),
        block_time: typeof edge.block_time === 'number' ? edge.block_time * 1000 : edge.block_time,
      };
      if (txData.block_time && !isNaN(new Date(txData.block_time).getTime())) {
        communityGroups.get(sourceComm).transactions.push(txData);
      }
    }
  });

  for (const [commId, group] of communityGroups) {
    const hasValidNametag = group.wallets.some(w => (w.layer === 2 || w.layer === 3) && w.label !== 'Unknown');
    if (!hasValidNametag || group.wallets.length < 2) continue;

    let clusterNametag = 'Unknown Cluster';
    const layer3Node = group.wallets.find(w => w.layer === 3 && w.label !== 'Unknown');
    const layer2Node = group.wallets.find(w => w.layer === 2 && w.label !== 'Unknown');
    if (layer3Node) clusterNametag = layer3Node.label;
    else if (layer2Node) clusterNametag = layer2Node.label;

    const risks = await Promise.allSettled(group.wallets.map(w => calculateRiskScore(w, group.wallets)));
    const validRisks = risks.map(r => r.status === 'fulfilled' ? r.value : 0.5).filter(r => r > 0);
    const clusterRisk = validRisks.length > 0 ? Math.max(...validRisks) : 0.5;

    const uniqueTxs = [...new Set(group.transactions.map(JSON.stringify))].map(JSON.parse);

    const totalValue = group.wallets.reduce((sum, w) => sum + parseFloat(w.totalValue || 0), 0);
    const times = uniqueTxs.map(tx => new Date(tx.block_time).getTime()).filter(t => !isNaN(t)).sort((a, b) => a - b);
    let velocity = 0;
    if (times.length > 1) {
      const timeSpanDays = (times[times.length - 1] - times[0]) / (1000 * 60 * 60 * 24);
      velocity = uniqueTxs.length / Math.max(timeSpanDays, 1);
    } else if (times.length === 1) {
      velocity = 1;
    }
    const uniqueTokens = new Set(uniqueTxs.map(tx => tx.tokenSymbol || 'unknown')).size;

    const topFeatures = ['burstScore', 'degree', 'clusteringCoeff'].sort((a, b) => {
      const avgA = group.wallets.reduce((sum, w) => sum + (w[a] || 0), 0) / group.wallets.length;
      const avgB = group.wallets.reduce((sum, w) => sum + (w[b] || 0), 0) / group.wallets.length;
      return avgB - avgA;
    }).slice(0, 3);

    logger.log(`Cluster ${commId}:`, { nametag: clusterNametag, wallets: group.wallets.length, tx: uniqueTxs.length, risk: clusterRisk.toFixed(3) });

    clusters.push({
      clusterId: commId,
      nametag: clusterNametag,
      image: layer3Node?.image || layer2Node?.image || null,
      wallets: group.wallets,
      transactions: uniqueTxs,
      riskScore: clusterRisk,
      velocity,
      uniqueTokens,
      topFeatures
    });
  }

  clusters.sort((a, b) => {
    const sumA = a.wallets.reduce((sum, w) => sum + parseFloat(w.totalValue || 0), 0);
    const sumB = b.wallets.reduce((sum, w) => sum + parseFloat(w.totalValue || 0), 0);
    return sumB - sumA;
  });

  logger.log(`Detected ${clusters.length} clusters`);
  return clusters;
}

// Export pure JS functions for fallback
export { dbscan, calculateModularity, louvainClustering };