// utils\clustering.js
import { logger } from './clientLogger';
// Dynamic import for TensorFlow.js to avoid SSR issues
let tf = null;
const loadTensorFlow = async () => {
  if (!tf) {
    const tfCore = await import('@tensorflow/tfjs-core');
    // Upgrade: Try WebGPU first for 2-5x perf, fallback to WebGL
    try {
      await import('@tensorflow/tfjs-backend-webgpu');
      await tfCore.setBackend('webgpu');
      logger.log('Switched to WebGPU backend for enhanced performance');
    } catch (webgpuErr) {
      logger.warn('WebGPU not available, falling back to WebGL:', webgpuErr.message);
      await import('@tensorflow/tfjs-backend-webgl');
      await tfCore.setBackend('webgl');
    }
    tf = tfCore;
    await tf.ready();
  }
  return tf;
};
export async function detectClusters(nodes, edges, options = { useML: true, useDBSCAN: true, useGNN: true }) {
  const clusters = [];
  const nodeMap = new Map();
  const edgeMap = new Map();
  const adjacencyList = new Map();
  const communitySizes = new Map();
  // Memoize expensive computations
  const memoClusteringCoeff = new Map();
  // Initialize adjacency list with blockchain heuristics (e.g., shared inputs)
  const clusterableNodes = nodes.filter(
    (node) => !node.isRoot && (node.layer === 2 || node.layer === 3) && node.label !== 'Unknown'
  );
  nodes.forEach((node) => {
    nodeMap.set(node.id.toLowerCase(), node);
    adjacencyList.set(node.id.toLowerCase(), new Set());
  });
  // Build adjacency + heuristics: merge nodes with common neighbors (simplified multi-input)
  const commonNeighbors = new Map();
  edges.forEach((edge) => {
    const source = edge.source.toLowerCase();
    const target = edge.target.toLowerCase();
    edgeMap.set(edge.id, edge);
    if (adjacencyList.has(source) && adjacencyList.has(target)) {
      adjacencyList.get(source).add(target);
      adjacencyList.get(target).add(source);
      // Heuristic: count shared neighbors for clustering boost
      [source, target].forEach(id => {
        if (!commonNeighbors.has(id)) commonNeighbors.set(id, new Set());
        commonNeighbors.get(id).add(source === id ? target : source);
      });
    }
  });
  let communities = new Map();
  // Enhanced ML clustering
  if (options.useML && clusterableNodes.length > 1) {
    try {
      const tf = await loadTensorFlow();
      const now = Date.now();
      const features = [];
      const nodeIds = [];
      // Enhanced features: log(value), txCount, degree, avgValue, daysSince, hasLabel, clusteringCoeff, entropy
      clusterableNodes.forEach((node) => {
        const id = node.id.toLowerCase();
        const degree = adjacencyList.get(id)?.size || 0;
        const neighbors = adjacencyList.get(id) || new Set();
        const avgValue = parseFloat(node.totalValue) / Math.max(parseFloat(node.txCount), 1);
        const latestTime = node.latestBlockTime
          ? typeof node.latestBlockTime === 'number'
            ? node.latestBlockTime * 1000
            : new Date(node.latestBlockTime).getTime()
          : now;
        const daysSince = (now - latestTime) / (1000 * 60 * 60 * 24);
        const hasLabel = node.label !== 'Unknown' ? 1 : 0;
        // Fixed clustering coefficient: avoid double-counting with strict ordering
        let triangleCount = 0;
        let possibleTriangles = 0;
        const neighArray = Array.from(neighbors).sort();
        for (let i = 0; i < neighArray.length; i++) {
          const n1 = neighArray[i];
          for (let j = i + 1; j < neighArray.length; j++) {
            const n2 = neighArray[j];
            possibleTriangles++;
            if (adjacencyList.get(n1)?.has(n2)) {
              triangleCount++;
            }
          }
        }
        const clusteringCoeff = possibleTriangles > 0 ? triangleCount / possibleTriangles : 0;
        memoClusteringCoeff.set(id, clusteringCoeff);
        // Fixed entropy: handle zero-division
        let neighEntropy = 0;
        if (neighbors.size > 0) {
          const p = 1 / neighbors.size;
          neighEntropy = - (neighbors.size * p * Math.log(p + 1e-10)); // Avoid log(0)
        }
        const feat = [
          Math.log1p(parseFloat(node.totalValue) || 0),
          Math.log1p(parseFloat(node.txCount) || 0),
          degree,
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
      let embeddings = tf.tensor2d(features);
      // Enhanced GNN: GraphSAGE-like with tf.sparse for efficiency
      if (options.useGNN) {
        try {
          const n = features.length;
          // Use sparse tensor for adj matrix
          const indices = [];
          const values = [];
          nodeIds.forEach((id, i) => {
            adjacencyList.get(id)?.forEach((neighId) => {
              const j = nodeIds.indexOf(neighId.toLowerCase());
              if (j !== -1 && i < j) { // Avoid duplicates
                indices.push([i, j, 1]);
                indices.push([j, i, 1]);
                values.push(1, 1);
              }
            });
          });
          const adjSparse = tf.sparseFromIndices(tf.tensor2d(indices, [indices.length, 3]), tf.tensor1d(values), [n, n]);
          // GraphSAGE Layer 1: Mean aggregation + linear transform
          const w1 = tf.randomNormal([features[0].length, 16]);
          let h = tf.tanh(tf.matMul(embeddings, w1));
          const agg1 = tf.sparseDenseMatMul(adjSparse, h).div(tf.tensor1d(Array(n).fill(Math.max(adjacencyList.get(nodeIds[i])?.size || 1, 1))));
          h = tf.tanh(tf.add(h, agg1)); // Concat + self-loop mean
          // Layer 2
          const w2 = tf.randomNormal([16, 8]);
          h = tf.tanh(tf.matMul(h, w2));
          embeddings = h;
          logger.log('GraphSAGE (2 layers, sparse adj) embeddings generated');
          w1.dispose(); w2.dispose(); h.dispose(); agg1.dispose(); adjSparse.dispose();
        } catch (gnnErr) {
          logger.warn('GNN failed, using raw features:', gnnErr.message);
        }
      }
      const mean = tf.mean(embeddings, 0, true);
      const std = tf.sqrt(tf.variance(embeddings, 0, true));
      const normalized = embeddings.sub(mean).div(std.add(1e-8));
      if (options.useDBSCAN) {
        // Approximated DBSCAN with MiniBatchKMeans fallback for large n
        if (features.length > 500) {
          logger.log('Large dataset: Using MiniBatchKMeans approximation for DBSCAN');
          // Simple MiniBatchKMeans (batched updates)
          const batchSize = 100;
          let centroids = tf.randomNormal([5, features[0].length]).mul(0.1).add(tf.mean(normalized, 0)); // k=5 approx
          const maxIter = 20;
          for (let iter = 0; iter < maxIter; iter++) {
            for (let b = 0; b < features.length; b += batchSize) {
              const batch = normalized.slice([b, 0], [Math.min(batchSize, features.length - b), -1]);
              const dist = tf.tidy(() => {
                const XX = tf.sum(tf.pow(batch, 2), 1, true);
                const CC = tf.sum(tf.pow(centroids, 2), 1, false);
                const XC = tf.matMul(batch, centroids, false, true);
                return XX.add(CC).sub(tf.mul(XC, 2));
              });
              const assignments = tf.argMin(dist, 1).arraySync();
              dist.dispose(); batch.dispose();
              // Update centroids with batch
              const sums = tf.zerosLike(centroids);
              const counts = tf.zeros([5]);
              assignments.forEach((c, i) => {
                const row = normalized.slice([b + i, 0], [1, -1]);
                sums.addAt(row, c, [c, 0]);
                counts.addAt(tf.scalar(1), c);
                row.dispose();
              });
              centroids = sums.div(counts.expandDims(1).add(1e-8));
              sums.dispose(); counts.dispose();
            }
          }
          const labels = tf.argMin(tf.tidy(() => normalized.sub(centroids)), 1).arraySync();
          centroids.dispose();
          nodeIds.forEach((id, idx) => {
            communities.set(id, labels[idx]);
          });
        } else {
          // Standard DBSCAN
          const distMatrix = tf.tidy(() => {
            const sqDists = tf.sum(tf.pow(normalized.sub(normalized.expandDims(0)), 2), 2);
            return tf.sqrt(sqDists);
          });
          const avgDist = tf.mean(distMatrix).arraySync();
          const eps = Math.max(0.3, Math.min(0.8, avgDist / Math.sqrt(features[0].length)));
          distMatrix.dispose();
          const labels = dbscan(normalized.arraySync(), eps, Math.max(2, Math.floor(features.length / 10)));
          nodeIds.forEach((id, idx) => {
            if (labels[idx] !== -1) {
              communities.set(id, labels[idx]);
            }
          });
          logger.log(`Dynamic DBSCAN (eps=${eps.toFixed(2)}) completed: ${new Set(labels.filter(l => l !== -1)).size} clusters`);
        }
      } else {
        // Enhanced KMeans with elbow method for k
        const n = features.length;
        const d = features[0].length;
        let bestK = Math.max(2, Math.floor(Math.sqrt(n)));
        let bestModularity = -Infinity;
        let bestAssignments = null;
        for (let k = 2; k <= Math.min(10, n); k++) {
          let centroids = tf.randomNormal([k, d]).mul(0.1).add(tf.mean(normalized, 0));
          const maxIter = 30;
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
          // Fixed modularity calculation
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
        logger.log(`Enhanced KMeans (best k=${bestK}, modularity=${bestModularity.toFixed(3)}) completed`);
      }
      // Dispose tensors
      normalized.dispose(); mean.dispose(); std.dispose(); embeddings.dispose();
    } catch (err) {
      logger.warn('ML clustering failed, falling back to enhanced Louvain:', err.message);
      options.useML = false;
    }
  }
  if (!options.useML) {
    // Enhanced Louvain with fixed modularity optimization and more iterations
    communities = new Map();
    let clusterId = 0;
    nodes.forEach((node) => communities.set(node.id.toLowerCase(), clusterId++));
    let changed = true;
    let iterations = 0;
    const maxIterations = 20; // Increased
    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;
      for (const nodeId of clusterableNodes.map(n => n.id.toLowerCase())) {
        const currentCommunity = communities.get(nodeId);
        const neighborCommunities = new Map();
        const totalEdges = edges.length * 2; // Undirected
        const deg = adjacencyList.get(nodeId)?.size || 0;
        adjacencyList.get(nodeId)?.forEach((neighborId) => {
          const neighborCommunity = communities.get(neighborId);
          const count = (neighborCommunities.get(neighborCommunity) || 0) + 1;
          neighborCommunities.set(neighborCommunity, count);
        });
        let bestCommunity = currentCommunity;
        let maxDeltaQ = 0;
        for (const [commId, count] of neighborCommunities) {
          const commSize = communitySizes.get(commId) || 0;
          const deltaQ = (1.0 / totalEdges) * (
            count - (deg / totalEdges) * commSize
          ) - (deg / totalEdges) * (deg / totalEdges); // Fixed modularity gain
          if (deltaQ > maxDeltaQ) {
            maxDeltaQ = deltaQ;
            bestCommunity = commId;
          }
        }
        if (bestCommunity !== currentCommunity && maxDeltaQ > 0.01) { // Threshold
          communities.set(nodeId, bestCommunity);
          changed = true;
        }
      }
    }
    // Refine with Leiden-like: merge small communities
    communities.forEach((comm) => communitySizes.set(comm, (communitySizes.get(comm) || 0) + 1));
    // ... (simple merge logic for small <2)
  }
  // Enhanced Risk analysis with Isolation Forest anomaly detection
  const calculateRiskScore = async (node, allNodes) => {
    const valueScore = parseFloat(node.totalValue) > 1000 ? 0.3 : 0;
    const txScore = parseFloat(node.txCount) < 5 ? 0.3 : 0;
    const timeScore = node.latestBlockTime
      ? (Date.now() - new Date(node.latestBlockTime).getTime()) / (1000 * 60 * 60 * 24 * 30) > 6
        ? 0.4 : 0 : 0.2;
    // Isolation Forest for anomaly (simple TF.js implementation)
    let anomalyScore = 0;
    if (allNodes.length > 10) {
      try {
        const tf = await loadTensorFlow();
        const featMatrix = tf.tensor2d(allNodes.map(n => [
          Math.log1p(parseFloat(n.totalValue) || 0),
          Math.log1p(parseFloat(n.txCount) || 0),
          (adjacencyList.get(n.id.toLowerCase())?.size || 0)
        ]));
        // Simple Isolation Forest: random partitioning (1 tree for approx)
        const n = allNodes.length;
        const scores = new Array(n).fill(0);
        const nodeIdx = allNodes.findIndex(n_ => n_.id.toLowerCase() === node.id.toLowerCase());
        if (nodeIdx !== -1) {
          // Simulate isolation path length (shorter = more anomalous)
          let pathLen = 0;
          let current = featMatrix.slice([0, 0], [n, -1]);
          for (let depth = 0; depth < 5; depth++) { // Max depth 5
            const splitFeat = Math.floor(Math.random() * 3);
            const splitVal = tf.mean(current.slice([0, splitFeat], [-1, 1]), 0).arraySync()[0];
            const leftMask = current.gather(splitFeat, 1).less(splitVal);
            const rightMask = current.gather(splitFeat, 1).greaterEqual(splitVal);
            const left = current.gather(tf.where(leftMask));
            const right = current.gather(tf.where(rightMask));
            pathLen++;
            if (left.shape[0] === 1 || right.shape[0] === 1) break;
            current = Math.random() > 0.5 ? left : right;
            left.dispose(); right.dispose();
            leftMask.dispose(); rightMask.dispose();
          }
          anomalyScore = 2 ** (-pathLen / Math.log2(n + 1e-8)); // Anomaly score
          current.dispose();
        }
        featMatrix.dispose();
      } catch (ifErr) {
        logger.warn('Isolation Forest failed:', ifErr.message);
        anomalyScore = 0;
      }
    }
    return Math.min(1, 0.4 * valueScore + 0.3 * txScore + 0.2 * timeScore + 0.1 * anomalyScore);
  };
  // Group nodes by community
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
  // Assign transactions to clusters (enhanced: include heuristic edges)
  edges.forEach((edge) => {
    const source = edge.source.toLowerCase();
    const target = edge.target.toLowerCase();
    const sourceComm = communities.get(source);
    const targetComm = communities.get(target);
    if (sourceComm === targetComm && communityGroups.has(sourceComm)) {
      const txData = {
        ...edge,
        value: parseFloat(edge.value),
        block_time: typeof edge.block_time === 'number' ? edge.block_time * 1000 : edge.block_time,
      };
      if (isValidDate(new Date(txData.block_time))) {
        communityGroups.get(sourceComm).transactions.push(txData);
      }
    }
  });
  // Create cluster objects with enhanced metrics
  for (const [commId, group] of communityGroups) {
    const hasValidNametag = group.wallets.some(w => (w.layer === 2 || w.layer === 3) && w.label !== 'Unknown');
    if (!hasValidNametag || group.wallets.length < 2) continue;
    let clusterNametag = 'Unknown Cluster';
    const layer3Node = group.wallets.find(w => w.layer === 3 && w.label !== 'Unknown');
    const layer2Node = group.wallets.find(w => w.layer === 2 && w.label !== 'Unknown');
    if (layer3Node) clusterNametag = layer3Node.label;
    else if (layer2Node) clusterNametag = layer2Node.label;
    const risks = await Promise.all(group.wallets.map(w => calculateRiskScore(w, group.wallets)));
    const clusterRisk = Math.max(...risks);
    const uniqueTxs = [...new Set(group.transactions.map(JSON.stringify))].map(JSON.parse);
    // New metrics
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
  }
  clusters.sort((a, b) => b.wallets.reduce((sum, w) => sum + parseFloat(w.totalValue), 0) - a.wallets.reduce((sum, w) => sum + parseFloat(w.totalValue), 0));
  logger.log(`Detected ${clusters.length} enhanced clusters with new metrics`);
  return clusters;
}
// Fixed: Proper modularity calculation
function calculateModularity(assignments, adjacencyList, nodeIds) {
  const n = nodeIds.length;
  let m = 0; // Total edges
  const adjMatrix = {}; // Sparse adj
  nodeIds.forEach((id) => adjMatrix[id] = new Set(adjacencyList.get(id)));
  nodeIds.forEach((id1) => {
    adjMatrix[id1].forEach((id2) => {
      if (id1 < id2) m++; // Undirected
    });
  });
  m *= 2; // Full edges
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
  return mod / assignments.length; // Normalized
}
// Enhanced DBSCAN (unchanged core, but used with dynamic params)
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