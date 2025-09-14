import { logger } from './clientLogger';

export function detectClusters(nodes, edges) {
  const clusters = [];
  const nodeMap = new Map();
  const edgeMap = new Map();
  const adjacencyList = new Map();

  // Initialize adjacency list
  nodes.forEach((node) => {
    nodeMap.set(node.id, node);
    adjacencyList.set(node.id, new Set());
  });

  // Build adjacency list from edges
  edges.forEach((edge, index) => {
    const source = edge.source;
    const target = edge.target;
    edgeMap.set(edge.id, edge);
    if (adjacencyList.has(source) && adjacencyList.has(target)) {
      adjacencyList.get(source).add(target);
      adjacencyList.get(target).add(source);
    }
  });

  // Community detection using a simplified Louvain-like approach
  const communities = new Map();
  let clusterId = 0;

  // Initialize each node in its own community
  nodes.forEach((node) => {
    communities.set(node.id, clusterId);
    clusterId++;
  });

  // Iterative modularity optimization
  let changed = true;
  let iterations = 0;
  const maxIterations = 10;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    for (const nodeId of nodes.map((n) => n.id)) {
      const currentCommunity = communities.get(nodeId);
      const neighborCommunities = new Map();

      // Count connections to each community
      adjacencyList.get(nodeId).forEach((neighborId) => {
        const neighborCommunity = communities.get(neighborId);
        neighborCommunities.set(neighborCommunity, (neighborCommunities.get(neighborCommunity) || 0) + 1);
      });

      // Find the community with the most connections
      let bestCommunity = currentCommunity;
      let maxConnections = neighborCommunities.get(currentCommunity) || 0;

      for (const [commId, count] of neighborCommunities) {
        if (count > maxConnections) {
          maxConnections = count;
          bestCommunity = commId;
        }
      }

      // Move node to the community with the most connections
      if (bestCommunity !== currentCommunity) {
        communities.set(nodeId, bestCommunity);
        changed = true;
      }
    }
  }

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

  // Assign transactions to clusters
  edges.forEach((edge) => {
    const sourceComm = communities.get(edge.source);
    const targetComm = communities.get(edge.target);
    if (sourceComm === targetComm && communityGroups.has(sourceComm)) {
      communityGroups.get(sourceComm).transactions.push({
        ...edge,
        source: edge.source,
        target: edge.target,
        type: edge.type,
        value: edge.value,
        txHash: edge.txHash,
        block_time: edge.block_time,
        tokenSymbol: edge.tokenSymbol,
        contractAddress: edge.contractAddress,
        tokenImage: edge.tokenImage,
        layer: edge.layer,
      });
    }
  });

  // Create cluster objects
  communityGroups.forEach((group, commId) => {
    // Only include clusters with at least one Layer 2 or Layer 3 node with a valid nametag
    const hasValidNametag = group.wallets.some(
      (wallet) => (wallet.layer === 2 || wallet.layer === 3) && wallet.label !== 'Unknown'
    );
    if (!hasValidNametag) return;

    // Prefer Layer 3 nametag, then Layer 2, then default to 'Unknown Cluster'
    let clusterNametag = 'Unknown Cluster';
    const layer3Node = group.wallets.find((w) => w.layer === 3 && w.label !== 'Unknown');
    const layer2Node = group.wallets.find((w) => w.layer === 2 && w.label !== 'Unknown');
    if (layer3Node) {
      clusterNametag = layer3Node.label;
    } else if (layer2Node) {
      clusterNametag = layer2Node.label;
    }

    clusters.push({
      clusterId: commId,
      nametag: clusterNametag,
      wallets: group.wallets,
      transactions: group.transactions,
    });
  });

  // Filter out clusters with only the root node or no valid nametags
  const filteredClusters = clusters.filter(
    (cluster) =>
      cluster.wallets.length > 1 ||
      cluster.wallets.some((wallet) => !wallet.isRoot && wallet.label !== 'Unknown')
  );

  logger.log(`Detected ${filteredClusters.length} clusters`);
  return filteredClusters;
}