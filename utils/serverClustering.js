import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client' // Import Prisma for DB access

const prisma = new PrismaClient() // Initialize Prisma client

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:3000',
  'https://xynapse-ai.vercel.app',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://farcaster.xynapseai.net',
  'https://base.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
].filter(Boolean)

function isAllowedOrigin(origin, referer) {
  try {
    if (
      origin &&
      (allowedOrigins.includes(origin) || new URL(origin).hostname.endsWith('xynapseai.net'))
    )
      return true
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin
      if (
        allowedOrigins.includes(refOrigin) ||
        new URL(refOrigin).hostname.endsWith('xynapseai.net')
      )
        return true
    }
    if (!origin && process.env.NODE_ENV === 'development') return true
    return false
  } catch {
    return false
  }
}

// Helper: Cosine similarity
function cosineSimilarity(vecA, vecB) {
  const dot = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0)
  const magA = Math.sqrt(vecA.reduce((sum, val) => sum + val ** 2, 0))
  const magB = Math.sqrt(vecB.reduce((sum, val) => sum + val ** 2, 0))
  return dot / (magA * magB + 1e-8)
}

// Helper: DFS cycle detection
function hasCycle(nodeId, adjacencyList, visited = new Set(), parent = null) {
  visited.add(nodeId)
  for (const neighbor of adjacencyList.get(nodeId) || []) {
    if (neighbor === parent) continue
    if (visited.has(neighbor)) return true
    if (hasCycle(neighbor, adjacencyList, visited, nodeId)) return true
  }
  return false
}

// Helper: Temporal entropy
function computeTxEntropy(txTimes, binSizeMs = 3600000) {
  if (txTimes.length < 2) return 0
  txTimes.sort((a, b) => a - b)
  const bins = new Map()
  txTimes.forEach((t) => {
    const bin = Math.floor(t / binSizeMs)
    bins.set(bin, (bins.get(bin) || 0) + 1)
  })
  const probs = Array.from(bins.values()).map((count) => count / txTimes.length)
  return -probs.reduce((sum, p) => sum + p * Math.log2(p + 1e-10), 0)
}

// Pre-trained weights JSON
const pretrainedClassifierWeights = {
  layer1: [
    [
      -0.3852231502532959, 0.14592701196670532, -0.5980711579322815, 0.4895792603492737,
      0.41286611557006836, -0.03675302863121033, 0.34242329001426697, 0.37972939014434814,
      0.3775983154773712,
    ],
    [
      -0.06689132750034332, 0.33151912689208984, -0.542883038520813, -0.23388928174972534,
      -0.1634332686662674, -0.5747097134590149, 0.41045066714286804, -0.2539864480495453,
      -0.424101322889328,
    ],
    [
      -0.31863081455230713, 0.3511461317539215, 0.10715492069721222, -0.41582995653152466,
      -0.6143429279327393, -0.15023601055145264, 0.028768405318260193, -0.0374741330742836,
      -0.09149989485740662,
    ],
    [
      -0.18120448291301727, -0.18139006197452545, -0.6059948801994324, -0.42443862557411194,
      0.035250164568424225, -0.3139837682247162, 0.5812512636184692, -0.23145431280136108,
      -0.25505200028419495,
    ],
    [
      -0.5485528111457825, -0.3241884112358093, -0.439699649810791, 0.09112757444381714,
      0.4426422119140625, -0.3805481195449829, -0.17007115483283997, 0.22208809852600098,
      -0.27100348472595215,
    ],
    [
      0.23837096989154816, 0.4884408712387085, 0.11906836181879044, 0.2725473940372467,
      0.29043710231781006, 0.49162957072257996, -0.31667372584342957, -0.03847460076212883,
      -0.4436405897140503,
    ],
    [
      -0.4314520061016083, 0.5624406337738037, -0.5410681962966919, 0.34240347146987915,
      0.3620026707649231, -0.020901739597320557, -0.17321592569351196, -0.4140666723251343,
      -0.08774274587631226,
    ],
    [
      -0.45467469096183777, 0.405123770236969, -0.47632884979248047, -0.2866925299167633,
      -0.25550344586372375, -0.17906156182289124, 0.4458136558532715, 0.0271187424659729,
      0.005169093608856201,
    ],
    [
      0.40937912464141846, -0.17941656708717346, 0.42937135696411133, -0.0015859007835388184,
      0.18249744176864624, -0.4305436611175537, 0.04371905326843262, -0.5555511713027954,
      0.12332719564437866,
    ],
  ],
  layer1_bias: [
    -0.07436960190534592, -0.06849371641874313, 0.08512482047080994, 0.07326409220695496,
    0.10816598683595657, 0.07864660769701004, 0.08734332770109177, -0.044292695820331573,
    -0.059030912816524506,
  ],
  layer2: [
    [-0.3077682554721832, -0.2684756815433502],
    [0.16913366317749023, 0.35469940304756165],
    [0.5912846922874451, 0.22383958101272583],
    [0.655550479888916, -0.5694327354431152],
    [0.38025081157684326, 0.11254998296499252],
    [0.6412615776062012, -0.7986372113227844],
    [0.584614098072052, -0.8046699166297913],
    [0.3449275493621826, 0.34431374073028564],
    [-0.581501305103302, -0.5230689644813538],
  ],
  layer2_bias: [0.07958962023258209, -0.0795896053314209],
}

// DBSCAN (Pure JS Implementation)
function dbscan(data, eps, minPts) {
  const n = data.length
  const labels = new Array(n).fill(-2)
  const dist = (p1, p2) => Math.sqrt(p1.reduce((sum, val, i) => sum + (val - p2[i]) ** 2, 0))
  const regionQuery = (pIdx) => {
    const neighbors = []
    for (let i = 0; i < n; i++) {
      if (i !== pIdx && dist(data[pIdx], data[i]) < eps) neighbors.push(i)
    }
    return neighbors
  }
  const expandCluster = (pIdx, neighbors, clusterId) => {
    labels[pIdx] = clusterId
    let i = 0
    while (i < neighbors.length) {
      const qIdx = neighbors[i]
      if (labels[qIdx] === -1) labels[qIdx] = clusterId
      if (labels[qIdx] === -2) {
        labels[qIdx] = clusterId
        const newNeighbors = regionQuery(qIdx)
        if (newNeighbors.length >= minPts) neighbors.push(...newNeighbors)
      }
      i++
    }
  }
  let clusterId = 0
  for (let i = 0; i < n; i++) {
    if (labels[i] !== -2) continue
    const neighbors = regionQuery(i)
    if (neighbors.length < minPts) labels[i] = -1
    else {
      expandCluster(i, neighbors, clusterId)
      clusterId++
    }
  }
  return labels
}

// Label Propagation
function propagateLabels(communities, nodeMap, nodeIds) {
  const communityLabels = new Map()
  for (const [nodeId, commId] of communities) {
    const node = nodeMap.get(nodeId)
    if (node && node.label !== 'Unknown') {
      if (!communityLabels.has(commId)) communityLabels.set(commId, new Map())
      communityLabels
        .get(commId)
        .set(node.label, (communityLabels.get(commId).get(node.label) || 0) + 1)
    }
  }
  for (const [commId, labelCounts] of communityLabels) {
    if (labelCounts.size > 0) {
      const majorityLabel = [...labelCounts.entries()].reduce(
        (max, curr) => (curr[1] > max[1] ? curr : max),
        ['', 0],
      )[0]
      nodeIds.forEach((id) => {
        if (communities.get(id) === commId) {
          const node = nodeMap.get(id)
          if (node && node.label === 'Unknown') node.label = majorityLabel
        }
      })
    }
  }
}

// Enhanced: Fetch known nametags from DB
async function fetchKnownNametags(addresses) {
  try {
    const known = await prisma.nametags.findMany({
      where: { address: { in: addresses.map((a) => a.toLowerCase()) } },
      select: { address: true, nametag: true, image: true },
    })
    return new Map(
      known.map((k) => [k.address.toLowerCase(), { label: k.nametag, image: k.image }]),
    )
  } catch (err) {
    console.error('Prisma fetch error:', err)
    return new Map()
  }
}

// Enhanced: Compute additional behavioral features
function computeBehavioralFeatures(node, nodeTxs, knownExchanges) {
  const incoming = nodeTxs.filter((tx) => tx.target.toLowerCase() === node.id.toLowerCase())
  const outgoing = nodeTxs.filter((tx) => tx.source.toLowerCase() === node.id.toLowerCase())

  // Sell ratio: outgoing / total volume
  const totalIn = incoming.reduce((sum, tx) => sum + parseFloat(tx.value || 0), 0)
  const totalOut = outgoing.reduce((sum, tx) => sum + parseFloat(tx.value || 0), 0)
  node.sellRatio = totalIn > 0 ? totalOut / totalIn : 0

  // Airdrop score: high unique incoming sources with low value each (threshold example: adjust as needed)
  const uniqueInSources = new Set(incoming.map((tx) => tx.source.toLowerCase()))
  node.airdropScore =
    uniqueInSources.size > 10 && (incoming.length > 0 ? totalIn / incoming.length : 0) < 100 ? 1 : 0

  // Interaction with exchanges: count connections to known exchanges
  node.interactionWithExchanges = [
    ...uniqueInSources,
    ...new Set(outgoing.map((tx) => tx.target.toLowerCase())),
  ].filter((addr) => knownExchanges.has(addr)).length
}

// Enhanced autoLabel with DB seeds and new behaviors
async function autoLabelWallets(wallets, tf = null, knownNametags) {
  const labels = {}
  for (const wallet of wallets) {
    const id = wallet.id.toLowerCase()
    const known = knownNametags.get(id)
    if (known) {
      labels[id] = { label: known.label, confidence: 1.0, image: known.image } // Seed from DB
      continue
    }

    const features = [
      Math.log1p(parseFloat(wallet.totalValue || 0)),
      Math.log1p(parseFloat(wallet.txCount || 0)),
      wallet.degree || 0,
      wallet.velocity || 0,
      wallet.uniqueTokens || 0,
      wallet.sellRatio || 0,
      wallet.airdropScore || 0,
      wallet.interactionWithExchanges || 0,
      wallet.txEntropy || 0,
    ]

    let predictedLabel = null
    let confidence = 0.5

    // Similarity to known: Find closest known wallet based on features (only if known in wallets)
    let maxSim = 0
    let closestKnownLabel = null
    for (const [knownId, knownData] of knownNametags) {
      const knownWallet = wallets.find((w) => w.id.toLowerCase() === knownId)
      if (knownWallet) {
        const knownFeatures = [
          Math.log1p(parseFloat(knownWallet.totalValue || 0)),
          Math.log1p(parseFloat(knownWallet.txCount || 0)),
          knownWallet.degree || 0,
          knownWallet.velocity || 0,
          knownWallet.uniqueTokens || 0,
          knownWallet.sellRatio || 0,
          knownWallet.airdropScore || 0,
          knownWallet.interactionWithExchanges || 0,
          knownWallet.txEntropy || 0,
        ]
        const sim = cosineSimilarity(features, knownFeatures)
        if (sim > maxSim) {
          maxSim = sim
          closestKnownLabel = knownData.label
        }
      }
    }
    if (maxSim > 0.8) {
      // Threshold for inheritance
      predictedLabel = `${closestKnownLabel} Deposit` // e.g., "Binance Deposit Wallet"
      confidence = maxSim
    } else {
      // Existing NN logic
      if (tf) {
        try {
          tf.tidy(() => {
            const paddedFeatures = features.slice(0, 9) // Slice to 9 features (match train)
            const input = tf.tensor2d([paddedFeatures])
            const w1 = tf.tensor2d(pretrainedClassifierWeights.layer1, [9, 9])
            const b1 = tf.tensor1d(pretrainedClassifierWeights.layer1_bias)
            const hidden = tf.relu(tf.add(tf.matMul(input, w1), b1)) // Add bias
            const w2 = tf.tensor2d(pretrainedClassifierWeights.layer2, [9, 2])
            const b2 = tf.tensor1d(pretrainedClassifierWeights.layer2_bias)
            const logits = tf.add(tf.matMul(hidden, w2), b2) // Add bias
            const probs = tf.softmax(logits).dataSync()

            const maxProb = Math.max(...probs)
            predictedLabel = maxProb > 0.6 ? (probs[0] > probs[1] ? 'Exchange' : 'Whale') : null // Binary như gốc
            confidence = maxProb
          })
        } catch (tfErr) {
          // Silently fail to rules
        }
      }

      // Rule-based fallback with new behaviors
      const totalValue = parseFloat(wallet.totalValue || 0)
      const degree = wallet.degree || 0
      const velocity = wallet.velocity || 0
      const uniqueTokens = wallet.uniqueTokens || 0

      if (!predictedLabel) {
        if (wallet.interactionWithExchanges > 5 || degree > 20) {
          predictedLabel = 'Exchange'
          confidence = 0.8
        } else if (totalValue > 1000000) {
          predictedLabel = 'Whale'
          confidence = 0.85
        } else if (wallet.airdropScore > 0.5) {
          predictedLabel = 'Airdrop'
          confidence = 0.7
        } else if (wallet.sellRatio > 1.5) {
          predictedLabel = 'Seller'
          confidence = 0.75
        } else if (totalValue > 100000 && degree > 8 && velocity < 1.5) {
          predictedLabel = 'Institution'
          confidence = 0.75
        }
      }
    }

    if (predictedLabel) {
      labels[id] = { label: predictedLabel, confidence: confidence.toFixed(2) }
    }
  }
  return labels
}

async function detectClustersServer(
  nodes,
  edges,
  options = { useGNN: true, useDBSCAN: true, useIF: true },
  tf = null,
  IsolationForest = null,
) {
  // 1. Filter Nodes
  let clusterableNodes = nodes.filter((n) => !n.isRoot && (n.layer === 2 || n.layer === 3))
  if (clusterableNodes.length > 2000) {
    const layer3Nodes = clusterableNodes.filter((n) => n.layer === 3)
    const layer2Nodes = clusterableNodes.filter((n) => n.layer === 2)
    const topLayer2 = layer2Nodes
      .sort((a, b) => parseFloat(b.totalValue || 0) - parseFloat(a.totalValue || 0))
      .slice(0, 1500 - layer3Nodes.length)

    clusterableNodes = [...layer3Nodes, ...topLayer2]
  }
  // 2. Build Adjacency & Basic Features
  const nodeMap = new Map(nodes.map((n) => [n.id.toLowerCase(), { ...n }]))
  const adjacencyList = new Map(nodes.map((n) => [n.id.toLowerCase(), new Set()]))

  edges.forEach((e) => {
    const source = e.source.toLowerCase()
    const target = e.target.toLowerCase()
    if (nodeMap.has(source) && nodeMap.has(target)) {
      adjacencyList.get(source).add(target)
      adjacencyList.get(target).add(source)
    }
  })
  const nodeTxsMap = new Map()
  clusterableNodes.forEach((node) => {
    const id = node.id.toLowerCase()
    const nodeTxs = edges.filter(
      (e) =>
        (e.source.toLowerCase() === id || e.target.toLowerCase() === id) &&
        nodeMap.has(e.source.toLowerCase()) &&
        nodeMap.has(e.target.toLowerCase()),
    )

    nodeTxsMap.set(id, nodeTxs)
    const times = nodeTxs
      .map((e) =>
        typeof e.block_time === 'number' ? e.block_time * 1000 : new Date(e.block_time).getTime(),
      )
      .filter((t) => !isNaN(t))
    times.sort((a, b) => a - b)

    node.txEntropy = computeTxEntropy(times)
    node.hasCycle = hasCycle(id, adjacencyList)
    node.degree = adjacencyList.get(id)?.size || 0
    node.velocity =
      times.length > 1
        ? times.length / ((times[times.length - 1] - times[0]) / 86400000 || 1)
        : times.length
    node.uniqueTokens = new Set(
      nodeTxs.map((e) => e.tokenSymbol || e.contractAddress || 'unknown'),
    ).size
    // Clustering Coeff
    let triangleCount = 0
    let possibleTriangles = 0
    const neighArray = Array.from(adjacencyList.get(id) || [])
    for (let i = 0; i < neighArray.length; i++) {
      for (let j = i + 1; j < neighArray.length; j++) {
        possibleTriangles++
        if (adjacencyList.get(neighArray[i])?.has(neighArray[j])) triangleCount++
      }
    }
    node.clusteringCoeff = possibleTriangles > 0 ? triangleCount / possibleTriangles : 0
    node.neighEntropy =
      neighArray.length > 0 ? -neighArray.length * Math.log(1 / neighArray.length) : 0
  })

  // NEW: Fetch known nametags for all nodes
  const allAddresses = nodes.map((n) => n.id.toLowerCase())
  const knownNametags = await fetchKnownNametags(allAddresses)
  const knownExchanges = new Set(
    [...knownNametags.keys()].filter((addr) =>
      knownNametags.get(addr)?.label?.includes('Exchange'),
    ),
  )

  // Enhanced features loop
  clusterableNodes.forEach((node) => {
    const nodeTxs = nodeTxsMap.get(node.id.toLowerCase()) || []
    computeBehavioralFeatures(node, nodeTxs, knownExchanges)
  })

  // 3. Feature Matrix Construction (now 12 features)
  const featuresList = clusterableNodes.map((node) => [
    Math.log1p(parseFloat(node.totalValue || 0)),
    Math.log1p(parseFloat(node.txCount || 0)),
    node.degree,
    node.velocity,
    node.uniqueTokens,
    node.txEntropy,
    node.hasCycle ? 1 : 0,
    node.clusteringCoeff,
    node.neighEntropy,
    node.sellRatio,
    node.airdropScore,
    node.interactionWithExchanges,
  ])
  const numFeatures = featuresList.length > 0 ? featuresList[0].length : 12

  // 4. Entity Resolution (Merging)
  const toMerge = []
  for (let i = 0; i < clusterableNodes.length; i++) {
    for (let j = i + 1; j < clusterableNodes.length; j++) {
      if (cosineSimilarity(featuresList[i], featuresList[j]) > 0.7) {
        toMerge.push([clusterableNodes[i].id.toLowerCase(), clusterableNodes[j].id.toLowerCase()])
      }
    }
  }

  const mergedGroups = new Map()
  clusterableNodes.forEach((node) =>
    mergedGroups.set(node.id.toLowerCase(), new Set([node.id.toLowerCase()])),
  )
  toMerge.forEach(([a, b]) => {
    if (mergedGroups.has(a) && mergedGroups.has(b)) {
      const groupA = mergedGroups.get(a)
      const groupB = mergedGroups.get(b)
      const merged = new Set([...groupA, ...groupB])
      merged.forEach((id) => mergedGroups.set(id, merged))
    }
  })
  const uniqueMergedGroups = new Set(
    Array.from(mergedGroups.values()).filter((group) => group.size > 1),
  )
  for (const group of uniqueMergedGroups) {
    const repId = Array.from(group)[0]
    const mergedNode = { ...nodeMap.get(repId) }
    let mergedTxs = nodeTxsMap.get(repId) || []
    let mergedValue = parseFloat(mergedNode.totalValue || 0)

    group.forEach((id) => {
      if (id !== repId && nodeMap.has(id)) {
        mergedValue += parseFloat(nodeMap.get(id).totalValue || 0)
        mergedTxs = [...mergedTxs, ...(nodeTxsMap.get(id) || [])]
        nodeMap.delete(id)
        adjacencyList.delete(id)

        edges.forEach((e) => {
          if (e.source.toLowerCase() === id) e.source = repId
          if (e.target.toLowerCase() === id) e.target = repId
        })
      }
    })

    mergedNode.totalValue = mergedValue.toString()
    nodeTxsMap.set(repId, mergedTxs)
    nodeMap.set(repId, mergedNode)

    const mergedAdj = new Set()
    group.forEach((id) =>
      adjacencyList.get(id)?.forEach((neigh) => {
        if (!group.has(neigh) && nodeMap.has(neigh)) mergedAdj.add(neigh)
      }),
    )
    adjacencyList.set(repId, mergedAdj)
  }
  // Refresh lists after merge
  clusterableNodes = Array.from(nodeMap.values()).filter(
    (n) => !n.isRoot && (n.layer === 2 || n.layer === 3),
  )

  // 5. Auto Labeling
  const autoLabels = await autoLabelWallets(clusterableNodes, tf, knownNametags)
  clusterableNodes.forEach((node) => {
    const al = autoLabels[node.id.toLowerCase()]
    if (al) node.autoLabel = al.label
  })
  // 6. GNN Embeddings (GraphSAGE - CPU Optimized)
  let embeddings = featuresList
  if (options.useGNN && tf && clusterableNodes.length > 0) {
    try {
      const n = clusterableNodes.length
      // Use tf.tidy to manage memory strictly
      embeddings = tf.tidy(() => {
        const nodeIds = clusterableNodes.map((n) => n.id.toLowerCase())
        const adjIndices = []
        const adjValues = []

        nodeIds.forEach((id, i) => {
          adjacencyList.get(id)?.forEach((neighId) => {
            const j = nodeIds.indexOf(neighId)
            if (j !== -1) {
              adjIndices.push([i, j])
              adjValues.push(1.0 / (adjacencyList.get(id).size || 1))
            }
          })
        })
        // Sparse Matrix
        const adjTensor = tf.sparseToDense(
          tf.tensor2d(adjIndices, [adjIndices.length, 2], 'int32'),
          tf.tensor1d(adjValues),
          [n, n],
          0,
        )

        // GraphSAGE Layers
        // Re-construct features tensor for current nodes
        let h = tf.tensor2d(featuresList.slice(0, n), [n, numFeatures])

        const w1 = tf.randomNormal([numFeatures, 16])
        const self1 = tf.matMul(h, w1)
        const neigh1 = tf.matMul(adjTensor, self1)
        h = tf.relu(tf.add(self1, neigh1))
        const w2 = tf.randomNormal([16, 8])
        const self2 = tf.matMul(h, w2)
        const neigh2 = tf.matMul(adjTensor, self2)
        h = tf.relu(tf.add(self2, neigh2))
        return h.arraySync() // Sync export ok for CPU/Small data
      })
    } catch (gnnErr) {
      console.warn('GNN calculation failed:', gnnErr.message)
      // Fallback to features
    }
  }
  // 7. DBSCAN
  let labels = new Array(clusterableNodes.length).fill(-1)
  if (options.useDBSCAN && clusterableNodes.length >= 2) {
    labels = dbscan(embeddings, 0.5, 2)
  }
  const communities = new Map()
  clusterableNodes.forEach((node, idx) => {
    if (labels[idx] !== -1) communities.set(node.id.toLowerCase(), labels[idx])
  })
  propagateLabels(
    communities,
    nodeMap,
    clusterableNodes.map((n) => n.id.toLowerCase()),
  )
  // 8. Risk Calculation
  const calculateRisk = async (node, groupWallets) => {
    const nodeIdx = clusterableNodes.findIndex((n) => n.id.toLowerCase() === node.id.toLowerCase())
    if (nodeIdx === -1) return 0
    let anomalyScore = 0
    if (options.useIF && IsolationForest && groupWallets.length > 1) {
      try {
        const iforest = new IsolationForest({ n_estimators: 20 })
        const trainData = groupWallets.map((n) => [
          Math.log1p(parseFloat(n.totalValue || 0)),
          n.degree || 0,
          n.velocity || 0,
        ])
        iforest.fit(trainData)
        const localIdx = groupWallets.findIndex((w) => w.id === node.id)
        if (localIdx >= 0) {
          anomalyScore = iforest.anomalyScore([trainData[localIdx]])[0]
        }
      } catch (err) {}
    }

    let illicitProb = 0
    if (tf && nodeIdx < featuresList.length) {
      try {
        illicitProb = tf.tidy(() => {
          const w1 = tf.tensor2d(pretrainedClassifierWeights.layer1, [9, 9])
          const w2 = tf.tensor2d(pretrainedClassifierWeights.layer2, [9, 2])
          const input = tf.tensor2d([featuresList[nodeIdx].slice(0, 9)]) // Slice to 9 for weights
          const hidden = tf.relu(tf.matMul(input, w1))
          const logits = tf.matMul(hidden, w2)
          return tf.softmax(logits).dataSync()[1]
        })
      } catch (err) {}
    }
    return Math.min(1, anomalyScore * 0.4 + illicitProb * 0.6)
  }
  // 9. Build Final Clusters
  const communityGroups = new Map()
  for (const [nodeId, commId] of communities) {
    const node = nodeMap.get(nodeId)
    if (node) {
      if (!communityGroups.has(commId))
        communityGroups.set(commId, { wallets: [], transactions: [] })
      communityGroups.get(commId).wallets.push(node)
    }
  }
  // Assign transactions to groups
  communityGroups.forEach((group) => {
    group.transactions = []
  })
  edges.forEach((edge) => {
    const s = edge.source.toLowerCase()
    const t = edge.target.toLowerCase()
    const cS = communities.get(s)
    const cT = communities.get(t)
    if (cS !== undefined && cS === cT && communityGroups.has(cS)) {
      communityGroups.get(cS).transactions.push(edge)
    }
  })
  const finalClusters = []
  for (const [commId, group] of communityGroups) {
    if (!group || !group.wallets || group.wallets.length < 2) continue
    const risks = await Promise.all(group.wallets.map((w) => calculateRisk(w, group.wallets)))
    const avgRisk = risks.reduce((sum, r) => sum + r, 0) / risks.length || 0
    const uniqueTxs = [...new Set((group.transactions || []).map(JSON.stringify))].map(JSON.parse)
    const totalValue = group.wallets.reduce((sum, w) => sum + parseFloat(w.totalValue || 0), 0)

    // Simple velocity calc
    const times = uniqueTxs.map((tx) => new Date(tx.block_time).getTime()).sort((a, b) => a - b)
    let velocity =
      times.length > 1
        ? uniqueTxs.length / ((times[times.length - 1] - times[0]) / 86400000 || 1)
        : 0
    // Nametag
    let clusterNametag = 'Unknown Cluster'
    const labeledNode =
      group.wallets.find((w) => w.label !== 'Unknown') || group.wallets.find((w) => w.autoLabel)
    if (labeledNode) clusterNametag = labeledNode.label || labeledNode.autoLabel
    const cluster = {
      clusterId: commId,
      nametag: clusterNametag,
      image: group.wallets[0]?.image || null,
      wallets: group.wallets,
      transactions: uniqueTxs,
      riskScore: avgRisk,
      velocity,
      uniqueTokens: new Set(uniqueTxs.map((t) => t.tokenSymbol)).size,
      totalValue: totalValue.toString(),
      topTokensVolume: [], // Simplified for space
      outstandingTxs: uniqueTxs.slice(0, 5),
      topFeatures: ['degree', 'txEntropy'],
      autoLabel: labeledNode?.autoLabel,
    }
    // Enhanced: Add behaviors array for professional analysis (like Arkham)
    cluster.behaviors = []
    if (group.wallets.some((w) => w.sellRatio > 1.5)) cluster.behaviors.push('Selling Activity')
    if (group.wallets.some((w) => w.airdropScore > 0.5)) cluster.behaviors.push('Airdrop Recipient')
    if (group.wallets.some((w) => w.interactionWithExchanges > 5))
      cluster.behaviors.push('Exchange Interaction')
    // Add more behaviors as needed based on features

    finalClusters.push(cluster)
  }
  finalClusters.sort((a, b) => parseFloat(b.totalValue) - parseFloat(a.totalValue))
  return finalClusters
}

export async function POST(request) {
  const startOverall = Date.now()
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')
  // 1. CORS Check
  if (!isAllowedOrigin(origin, referer)) {
    return NextResponse.json({ success: false, error: 'Forbidden Origin' }, { status: 403 })
  }
  // 2. Load Libraries Dynamically (CPU Backend for Vercel)
  let tf = null
  let IsolationForest = null
  try {
    const tfModule = await import('@tensorflow/tfjs')
    await tfModule.setBackend('cpu') // CRITICAL: Use CPU to avoid binaries
    await tfModule.ready()
    tf = tfModule
  } catch (e) {
    console.warn('TF Load Failed:', e.message)
  }
  try {
    const ifModule = await import('ml-isolation-forest')
    IsolationForest =
      ifModule.IsolationForest || ifModule.default?.IsolationForest || ifModule.default
  } catch (e) {
    console.warn('IF Load Failed:', e.message)
  }
  // 3. Process Request
  try {
    const body = await request.json()
    const { nodes, edges, options } = body
    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      return NextResponse.json({ success: false, error: 'Invalid input' }, { status: 400 })
    }
    const clusters = await detectClustersServer(nodes, edges, options, tf, IsolationForest)
    return NextResponse.json({
      success: true,
      clusters,
      time: Date.now() - startOverall,
    })
  } catch (error) {
    console.error('Cluster API Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 },
    )
  }
}

export { dbscan, propagateLabels, autoLabelWallets, detectClustersServer }
