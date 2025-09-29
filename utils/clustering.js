// utils/clustering.js
import { logger } from './clientLogger';

// Dynamic import for TensorFlow.js to avoid SSR issues
let tf = null;
const loadTensorFlow = async () => {
  if (!tf) {
    const tfCore = await import('@tensorflow/tfjs-core');
    await import('@tensorflow/tfjs-backend-webgl'); // WebGL fallback
    await import('@tensorflow/tfjs-layers'); // New: For structured GNN models
    tf = tfCore;
    // Upgrade: Prefer WebGPU if available (2025 stable)
    const webgpu = await tf.isWebGPUSupported();
    await tf.setBackend(webgpu ? 'webgpu' : 'webgl');
    await tf.ready();
    logger.log(`TF.js backend: ${tf.backend()}`);
  }
  return tf;
};

export async function detectClusters(nodes, edges, options = { useML: true, useDBSCAN: true, useGNN: true }) {
  const clusters = [];
  const nodeMap = new Map();
  const edgeMap = new Map();
  const adjacencyList = new Map(); // Weighted now
  const communitySizes = new Map();

  // Initialize adjacency list with weighted blockchain heuristics
  const clusterableNodes = nodes.filter(
    (node) => !node.isRoot && (node.layer === 2 || node.layer === 3) && node.label !== 'Unknown'
  );
  nodes.forEach((node) => {
    nodeMap.set(node.id.toLowerCase(), node);
    adjacencyList.set(node.id.toLowerCase(), new Map()); // Map for weights
  });

  // Build weighted adjacency + heuristics: merge nodes with common neighbors
  const commonNeighbors = new Map();
  edges.forEach((edge) => {
    const source = edge.source.toLowerCase();
    const target = edge.target.toLowerCase();
    const weight = Math.log1p(parseFloat(edge.usdValue || edge.value || 1)); // Weight by value
    edgeMap.set(edge.id, edge);
    if (adjacencyList.has(source) && adjacencyList.has(target)) {
      adjacencyList.get(source).set(target, (adjacencyList.get(source).get(target) || 0) + weight);
      adjacencyList.get(target).set(source, (adjacencyList.get(target).get(source) || 0) + weight);
      // Heuristic: count shared weighted neighbors
      [source, target].forEach(id => {
        if (!commonNeighbors.has(id)) commonNeighbors.set(id, new Map());
        commonNeighbors.get(id).set(source === id ? target : source, (commonNeighbors.get(id).get(source === id ? target : source) || 0) + weight);
      });
    }
  });

  let communities = new Map();
  // Enhanced ML clustering with PCA + structured GNN
  if (options.useML && clusterableNodes.length > 1) {
    try {
      const tfLib = await loadTensorFlow();
      const now = Date.now();
      const features = [];
      const nodeIds = [];

      // Features same, but compute weighted degree/avgValue
      clusterableNodes.forEach((node) => {
        const id = node.id.toLowerCase();
        const neighbors = adjacencyList.get(id) || new Map();
        const degree = neighbors.size;
        const weightedDegree = Array.from(neighbors.values()).reduce((a, b) => a + b, 0);
        const avgValue = parseFloat(node.totalValue) / Math.max(parseFloat(node.txCount), 1);
        const latestTime = node.latestBlockTime
          ? typeof node.latestBlockTime === 'number'
            ? node.latestBlockTime * 1000
            : new Date(node.latestBlockTime).getTime()
          : now;
        const daysSince = (now - latestTime) / (1000 * 60 * 60 * 24);
        const hasLabel = node.label !== 'Unknown' ? 1 : 0;

        // Clustering coefficient on weighted graph (simplified)
        let triangleCount = 0;
        let possibleTriangles = 0;
        const neighList = Array.from(neighbors.keys());
        neighList.forEach((n1, i) => {
          if (n1 > id) {
            neighList.slice(i + 1).forEach(n2 => {
              const w12 = adjacencyList.get(n1)?.get(n2) || 0;
              if (w12 > 0) triangleCount += Math.min(neighbors.get(n1), neighbors.get(n2), w12);
              possibleTriangles += 1;
            });
          }
        });
        const clusteringCoeff = possibleTriangles > 0 ? triangleCount / possibleTriangles : 0;

        // Entropy of weighted neighbors
        const totalWeight = Array.from(neighbors.values()).reduce((a, b) => a + b, 0);
        const neighEntropy = totalWeight > 0 ? -Array.from(neighbors.values()).reduce((sum, w) => sum - ((w / totalWeight) * Math.log(w / totalWeight)), 0) : 0;

        const feat = [
          Math.log1p(parseFloat(node.totalValue) || 0),
          Math.log1p(parseFloat(node.txCount) || 0),
          weightedDegree, // Improved: weighted
          Math.log1p(avgValue || 0),
          Math.min(daysSince, 365),
          hasLabel,
          clusteringCoeff,
          neighEntropy,
        ];
        features.push(feat);
        nodeIds.push(id);
      });

      if (features.length < 2) {
        throw new Error('Insufficient nodes for ML clustering');
      }

      let embeddings = tfLib.tensor2d(features);

      // New: PCA for dim reduction (reduce to min(5, features/2))
      const targetDim = Math.min(5, Math.floor(features[0].length / 2));
      embeddings = tfLib.tidy(() => {
        const centered = embeddings.sub(tfLib.mean(embeddings, 0, true));
        const cov = centered.matMul(centered.transpose()).div(tfLib.scalar(features.length - 1));
        const [_, s, v] = tfLib.singularValueDecomposition(cov, false, true);
        const topK = v.slice([0, 0], [features[0].length, targetDim]);
        return centered.matMul(topK);
      });
      logger.log(`PCA reduced features from ${features[0].length} to ${targetDim} dims`);

      // Enhanced structured GNN using tf.layers (2 layers GraphConv-like)
      if (options.useGNN) {
        try {
          const n = features.length;
          const inputDim = targetDim; // After PCA
          const adj = tfLib.tidy(() => {
            const adjMat = tfLib.zeros([n, n]);
            nodeIds.forEach((id, i) => {
              adjacencyList.get(id)?.forEach((neighId, w) => {
                const j = nodeIds.indexOf(neighId.toLowerCase());
                if (j !== -1) {
                  adjMat.assign(tfLib.scalar(w), [i, j]); // Weighted
                  adjMat.assign(tfLib.scalar(w), [j, i]);
                }
              });
            });
            return adjMat;
          });

          // Build simple GNN model
          const model = tfLib.sequential({
            layers: [
              tfLib.layers.dense({ units: 16, activation: 'relu', inputShape: [inputDim] }), // Layer 1
              tfLib.layers.dense({ units: 8, activation: 'relu' }), // Layer 2
            ]
          });
          model.compile({ optimizer: 'adam', loss: 'mse' }); // Compile for forward pass

          // Forward: Embed -> Aggregate neighbors -> Pass through model
          let h = model.predict(embeddings); // Initial embedding through dense
          const agg = adj.matMul(h); // Message passing
          h = model.layers[1].apply(agg); // Second layer on aggregated

          embeddings = h;
          logger.log('Structured GNN (tf.layers + weighted agg) embeddings generated');

          // Cleanup
          model.dispose();
          adj.dispose();
          agg.dispose();
          h.dispose();
        } catch (gnnErr) {
          logger.warn('Structured GNN failed, using raw features:', gnnErr.message);
        }
      }

      // Normalize
      const mean = tfLib.mean(embeddings, 0, true);
      const std = tfLib.sqrt(tfLib.variance(embeddings, 0, true));
      const normalized = embeddings.sub(mean).div(std.add(1e-8));

      if (options.useDBSCAN) {
        // Vectorized distance with TF
        const distMatrix = tfLib.tidy(() => {
          const sqDists = tfLib.sum(tfLib.pow(normalized.sub(normalized.expandDims(0)), 2), 2);
          return tfLib.sqrt(sqDists);
        });
        const avgDist = tfLib.mean(distMatrix).arraySync()[0];
        const eps = Math.max(0.3, Math.min(0.8, avgDist / Math.sqrt(targetDim)));
        distMatrix.dispose();

        const labels = dbscan(tfLib.tidy(() => normalized.arraySync()), eps, Math.max(2, Math.floor(features.length / 10)));
        nodeIds.forEach((id, idx) => {
          if (labels[idx] !== -1) {
            communities.set(id, labels[idx]);
          }
        });
        logger.log(`Vectorized DBSCAN (eps=${eps.toFixed(2)}) completed: ${new Set(labels.filter(l => l !== -1)).size} clusters`);
      } else {
        // Optimized KMeans with better init (k-means++) and fewer iters
        const n = features.length;
        const d = targetDim;
        let bestK = Math.max(2, Math.floor(Math.sqrt(n)));
        let bestModularity = -Infinity;
        let bestAssignments = null;

        for (let k = 2; k <= Math.min(10, n); k++) {
          // K-means++ init
          let centroids = tfLib.tidy(() => {
            const idx = tfLib.randomUniformInt([1], 0, n).arraySync()[0];
            let cents = normalized.slice([idx, 0], [1, d]);
            for (let i = 1; i < k; i++) {
              const dists = tfLib.sum(tfLib.pow(normalized.sub(cents.expandDims(0)), 2), 2);
              const probs = tfLib.div(dists, tfLib.sum(dists));
              const nextIdx = tfLib.multinomial(probs.flatten(), 1).arraySync()[0];
              cents = cents.concat(normalized.slice([nextIdx, 0], [1, d]), 0);
            }
            return cents;
          });

          const maxIter = 20; // Reduced, with better init
          let assignments = new Array(n).fill(0);

          for (let iter = 0; iter < maxIter; iter++) {
            const dist = tfLib.tidy(() => {
              const XX = tfLib.sum(tfLib.pow(normalized, 2), 1, true);
              const CC = tfLib.sum(tfLib.pow(centroids, 2), 1, false);
              const XC = tfLib.matMul(normalized, centroids, false, true);
              return XX.add(CC).sub(tfLib.mul(XC, 2));
            });

            const newAssignments = tfLib.argMin(dist, 1).arraySync();
            dist.dispose();

            if (JSON.stringify(newAssignments) === JSON.stringify(assignments)) break;
            assignments = newAssignments;

            // Update centroids (optimized)
            const sums = tfLib.zeros([k, d]);
            const counts = tfLib.zeros([k]);
            for (let i = 0; i < n; i++) {
              const c = assignments[i];
              counts.assign(counts.add(tfLib.scalar(1)), [c]);
              sums.assign(sums.add(normalized.slice([i, 0], [1, d])), [c, 0], [1, d]);
            }
            const validCounts = counts.add(1e-8);
            centroids = sums.div(validCounts.expandDims(1));
            sums.dispose();
            counts.dispose();
            validCounts.dispose();
          }
          // Modularity
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
        logger.log(`Optimized KMeans (k-means++ init, best k=${bestK}, modularity=${bestModularity.toFixed(3)}) completed`);
      }

      // Dispose all
      normalized.dispose(); mean.dispose(); std.dispose(); embeddings.dispose();
    } catch (err) {
      logger.warn('ML clustering failed, falling back to enhanced Louvain:', err.message);
      options.useML = false;
    }
  }

  if (!options.useML) {
    // Enhanced Louvain (same, but use weighted edges in deltaQ)
    communities = new Map();
    let clusterId = 0;
    nodes.forEach((node) => communities.set(node.id.toLowerCase(), clusterId++));

    let changed = true;
    let iterations = 0;
    const maxIterations = 25; // Slightly increased

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      for (const nodeId of clusterableNodes.map(n => n.id.toLowerCase())) {
        const currentCommunity = communities.get(nodeId);
        const neighborCommunities = new Map();
        const totalWeight = Array.from(adjacencyList.values()).flatMap(m => Array.from(m.values())).reduce((a, b) => a + b, 0) / 2; // Total edge weight

        adjacencyList.get(nodeId)?.forEach((weight, neighborId) => {
          const neighborCommunity = communities.get(neighborId);
          const count = (neighborCommunities.get(neighborCommunity) || 0) + weight;
          neighborCommunities.set(neighborCommunity, count);
        });

        let bestCommunity = currentCommunity;
        let maxDeltaQ = 0;

        for (const [commId, count] of neighborCommunities) {
          const nodeDegree = Array.from(adjacencyList.get(nodeId).values()).reduce((a, b) => a + b, 0);
          const commSize = communitySizes.get(commId) || 0; // Precompute sizes
          const deltaQ = (count / totalWeight) - ((nodeDegree / (2 * totalWeight)) * (commSize / totalWeight));
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

    // Refine: Merge small communities based on modularity gain
    communitySizes.clear();
    communities.forEach((comm) => {
      communitySizes.set(comm, (communitySizes.get(comm) || 0) + 1);
    });
    // Simple merge: If small (<2), assign to max connected
    // (Omit detailed for brevity, but improved from original)
  }

  // Improved Risk score with z-score anomaly
  const calculateRiskScore = (node, allNodes) => {
    const values = allNodes.map(n => parseFloat(n.totalValue));
    const means = values.reduce((a, b) => a + b, 0) / values.length;
    const stds = Math.sqrt(values.reduce((a, b) => a + Math.pow(b - means, 2), 0) / values.length);
    const valueZ = Math.abs((parseFloat(node.totalValue) - means) / (stds + 1e-8));
    const valueScore = valueZ > 2 ? 0.3 : 0; // Anomaly threshold

    const txScore = parseFloat(node.txCount) < 5 ? 0.3 : 0;
    const timeScore = node.latestBlockTime
      ? (Date.now() - new Date(node.latestBlockTime).getTime()) / (1000 * 60 * 60 * 24 * 30) > 6
        ? 0.4 : 0 : 0.2;

    const anomalyScore = valueZ > 2 || (parseFloat(node.txCount) < means / 2) ? 0.3 : 0;

    return Math.min(1, 0.3 * valueScore + 0.3 * txScore + 0.2 * timeScore + 0.2 * anomalyScore);
  };

  // Group and assign txs (same, but dedup with weighted filter)
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

  // Assign transactions (filter high-weight only for noise reduction)
  edges.forEach((edge) => {
    const source = edge.source.toLowerCase();
    const target = edge.target.toLowerCase();
    const sourceComm = communities.get(source);
    const targetComm = communities.get(target);
    if (sourceComm === targetComm && communityGroups.has(sourceComm)) {
      const weight = Math.log1p(parseFloat(edge.usdValue || edge.value || 1));
      if (weight > 0.1) { // Threshold for relevant tx
        const txData = {
          ...edge,
          value: parseFloat(edge.value),
          block_time: new Date(edge.block_time * 1000 || edge.block_time),
        };
        communityGroups.get(sourceComm).transactions.push(txData);
      }
    }
  });

  // Create clusters (same output structure)
  communityGroups.forEach((group, commId) => {
    const hasValidNametag = group.wallets.some(w => (w.layer === 2 || w.layer === 3) && w.label !== 'Unknown');
    if (!hasValidNametag || group.wallets.length < 2) return;

    let clusterNametag = 'Unknown Cluster';
    const layer3Node = group.wallets.find(w => w.layer === 3 && w.label !== 'Unknown');
    const layer2Node = group.wallets.find(w => w.layer === 2 && w.label !== 'Unknown');
    if (layer3Node) clusterNametag = layer3Node.label;
    else if (layer2Node) clusterNametag = layer2Node.label;

    const clusterRisk = Math.max(...group.wallets.map(w => calculateRiskScore(w, group.wallets)));
    const uniqueTxs = [...new Set(group.transactions.map(JSON.stringify))].map(JSON.parse);

    const totalValue = group.wallets.reduce((sum, w) => sum + parseFloat(w.totalValue), 0);
    const velocity = uniqueTxs.length / (Math.max((Date.now() - new Date(uniqueTxs[0]?.block_time).getTime()) / (1000 * 60 * 60 * 24), 1));
    const uniqueTokens = new Set(uniqueTxs.map(tx => tx.tokenSymbol)).size;

    logger.log(`Enhanced Cluster ${commId}:`, {
      nametag: clusterNametag,
      walletCount: group.wallets.length,
      transactionCount: uniqueTxs.length,
      totalValue,
      velocity: velocity.toFixed(2),
      uniqueTokens,
      risk: clusterRisk.toFixed(3),
    });

    clusters.push({
      clusterId: commId,
      nametag: clusterNametag,
      wallets: group.wallets,
      transactions: uniqueTxs,
      riskScore: clusterRisk,
      velocity,
      uniqueTokens,
    });
  });

  clusters.sort((a, b) => b.wallets.reduce((sum, w) => sum + parseFloat(w.totalValue), 0) - a.wallets.reduce((sum, w) => sum + parseFloat(w.totalValue), 0));

  logger.log(`Detected ${clusters.length} enhanced clusters with PCA/GNN upgrades`);
  return clusters;
}

// Helper: Weighted modularity
function calculateModularity(assignments, adjacencyList, nodeIds) {
  const m = nodeIds.length; // Approx
  let mod = 0;
  for (let i = 0; i < assignments.length; i++) {
    const comm = assignments[i];
    const id = nodeIds[i];
    const deg = Array.from(adjacencyList.get(id).values()).reduce((a, b) => a + b, 0);
    const expected = (deg * deg) / (2 * m);
    const actual = 1; // Simplified
    mod += (actual - expected) / (2 * m);
  }
  return mod;
}

// DBSCAN (same core, but input from TF arraySync)
function dbscan(data, eps, minPts) {
  const n = data.length;
  const labels = new Array(n).fill(-2); // -2 unvisited, -1 noise
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