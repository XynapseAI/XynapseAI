function truncateAddress(addr) {
    if (!addr) return 'N/A'
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function isValidDate(date) {
    return date instanceof Date && !isNaN(date)
}

function aggregateWallets(
    incomingData,
    outgoingData,
    layer3Data,
    rootAddress,
    page,
    filterType,
    rootNametag = 'Unknown',
    rootImage = '/icons/default.webp',
) {
    const walletMap = new Map()
    const nametags = {}
    const edges = []
    const rootLower = rootAddress.toLowerCase()
    const isTokenQuery = rootNametag.endsWith(' Token')
    walletMap.set(rootLower, {
        address: rootLower,
        nametag: rootNametag, // Updated with passed nametag
        image: rootImage, // Updated with passed image
        chainLogo: '/icons/default.webp',
        tokenSymbol: 'Unknown',
        totalValue: 0,
        txCount: 0,
        latestBlockTime: null,
        type: 'root',
        layer: 1,
    })
    nametags[rootLower] = {
        name: rootNametag, // Updated with passed nametag
        image: rootImage, // Updated with passed image
    }
    const addWallet = (address, tx, type, layer) => {
        if (filterType === 'incoming' && type !== 'incoming') return
        if (filterType === 'outgoing' && type !== 'outgoing') return
        const addrLower = address.toLowerCase()
        const isLayer2Add = addrLower === tx.layer2Address?.toLowerCase()
        const walletNametag = isLayer2Add ? tx.nametagLayer2 || 'Unknown' : tx.nametag || 'Unknown'
        const walletImage = isLayer2Add
            ? tx.imageLayer2 || '/icons/default.webp'
            : tx.image || '/icons/default.webp'
        if (!walletMap.has(addrLower)) {
            walletMap.set(addrLower, {
                address: addrLower,
                nametag: walletNametag,
                image: walletImage,
                chainLogo: tx.chainLogo || '/icons/default.webp',
                tokenSymbol: tx.tokenSymbol || 'Unknown',
                totalValue: 0,
                txCount: 0,
                latestBlockTime: null,
                type,
                layer,
            })
            nametags[addrLower] = {
                name: walletNametag,
                image: walletImage,
            }
        }
        const wallet = walletMap.get(addrLower)
        if (wallet.nametag === 'Unknown' && walletNametag !== 'Unknown') {
            wallet.nametag = walletNametag
            wallet.image = walletImage
            nametags[addrLower].name = walletNametag
            nametags[addrLower].image = walletImage
        }
        const txValue = Number(tx.usdValue || tx.value || 0)
        if (isNaN(txValue)) return // Validate value
        wallet.totalValue += txValue
        wallet.txCount += 1
        const txTime = typeof tx.block_time === 'number' ? tx.block_time * 1000 : tx.block_time
        const walletTime = wallet.latestBlockTime
            ? typeof wallet.latestBlockTime === 'number'
                ? wallet.latestBlockTime * 1000
                : wallet.latestBlockTime
            : null
        if (isValidDate(new Date(txTime)) && (!walletTime || new Date(txTime) > new Date(walletTime))) {
            wallet.latestBlockTime = tx.block_time
        }
    }
    const filteredIncoming =
        filterType === 'all' || filterType === 'incoming'
            ? incomingData.filter(
                (tx) => tx.address.toLowerCase() !== rootLower && tx.type === 'incoming',
            )
            : []
    const filteredOutgoing =
        filterType === 'all' || filterType === 'outgoing'
            ? outgoingData.filter(
                (tx) => tx.address.toLowerCase() !== rootLower && tx.type === 'outgoing',
            )
            : []
    filteredIncoming.forEach((tx) => addWallet(tx.address, tx, 'incoming', 2))
    filteredOutgoing.forEach((tx) => addWallet(tx.address, tx, 'outgoing', 2))
    const filteredLayer3 = layer3Data
    filteredLayer3.forEach((tx) => {
        if (tx.layer2Address) {
            addWallet(tx.layer2Address, tx, tx.type === 'incoming' ? 'outgoing' : 'incoming', 2)
        }
        addWallet(tx.address, tx, tx.type, 3)
    })
    const nodes = Array.from(walletMap.values()).map((wallet) => ({
        data: {
            id: wallet.address,
            label: wallet.nametag,
            image: wallet.image,
            chainLogo: wallet.chainLogo,
            tokenSymbol: wallet.tokenSymbol,
            totalValue: wallet.totalValue.toFixed(6),
            txCount: wallet.txCount,
            latestBlockTime: wallet.latestBlockTime,
            type: wallet.type,
            layer: wallet.layer,
            isRoot: wallet.address === rootLower,
        },
    }))
    filteredIncoming.forEach((tx, index) => {
        if (walletMap.has(tx.address.toLowerCase()) && walletMap.has(rootLower)) {
            edges.push({
                data: {
                    id: `in-edge-${page}-${index}-${tx.hash}`,
                    source: tx.address.toLowerCase(),
                    target: rootLower,
                    value: Number(tx.value).toFixed(6),
                    usdValue: Number(tx.usdValue || 0).toFixed(6),
                    type: 'incoming',
                    txHash: tx.hash,
                    block_time: tx.block_time,
                    tokenSymbol: tx.tokenSymbol,
                    contractAddress: tx.contractAddress,
                    tokenImage: tx.tokenImage,
                    layer: 2,
                },
            })
        }
    })
    filteredOutgoing.forEach((tx, index) => {
        if (walletMap.has(rootLower) && walletMap.has(tx.address.toLowerCase())) {
            edges.push({
                data: {
                    id: `out-edge-${page}-${index}-${tx.hash}`,
                    source: rootLower,
                    target: tx.address.toLowerCase(),
                    value: Number(tx.value).toFixed(6),
                    usdValue: Number(tx.usdValue || 0).toFixed(6),
                    type: 'outgoing',
                    txHash: tx.hash,
                    block_time: tx.block_time,
                    tokenSymbol: tx.tokenSymbol,
                    contractAddress: tx.contractAddress,
                    tokenImage: tx.tokenImage,
                    layer: 2,
                },
            })
        }
    })
    filteredLayer3.forEach((tx, index) => {
        const layer2Address = tx.layer2Address.toLowerCase()
        const layer3Address = tx.address.toLowerCase()
        if (walletMap.has(layer2Address) && walletMap.has(layer3Address)) {
            edges.push({
                data: {
                    id: `layer3-edge-${page}-${index}-${tx.hash}`,
                    source: tx.type === 'incoming' ? layer3Address : layer2Address,
                    target: tx.type === 'incoming' ? layer2Address : layer3Address,
                    value: Number(tx.value).toFixed(6),
                    usdValue: Number(tx.usdValue || 0).toFixed(6),
                    type: tx.type,
                    txHash: tx.hash,
                    block_time: tx.block_time,
                    tokenSymbol: tx.tokenSymbol,
                    contractAddress: tx.contractAddress,
                    tokenImage: tx.tokenImage,
                    layer: 3,
                },
            })
        }
    })
    return { nodes, edges, nametags }
}

function computePositionedNodes(nodesData, edgesData) {
    const positionedNodes = nodesData.map((n) => ({ ...n }))
    const rootData = positionedNodes.find((n) => n.isRoot)
    if (rootData) {
        rootData.x = 0
        rootData.y = 0
        rootData.fx = rootData.x
        rootData.fy = rootData.y
    }
    const layer2Datas = positionedNodes.filter((n) => n.layer === 2)
    const radius2 = 250
    const numL2 = layer2Datas.length
    if (numL2 > 0) {
        const angleStep = (2 * Math.PI) / numL2
        layer2Datas.forEach((nd, i) => {
            const angle = i * angleStep
            nd.x = Math.cos(angle) * radius2
            nd.y = Math.sin(angle) * radius2
        })
    }
    const layer3Datas = positionedNodes.filter((n) => n.layer === 3)
    const parentChildMap = new Map() // childId -> parentId
    const graphLinksTemp = edgesData // Temp for positioning
    graphLinksTemp.forEach((link) => {
        if (link.layer === 3) {
            const ids = [link.source, link.target]
            const l2id =
                positionedNodes.find((n) => n.id === ids[0] && n.layer === 2)?.id ||
                positionedNodes.find((n) => n.id === ids[1] && n.layer === 2)?.id
            if (l2id) {
                const childId = ids[0] === l2id ? ids[1] : ids[0]
                parentChildMap.set(childId, l2id)
            }
        }
    })
    const childrenByParent = new Map()
    layer3Datas.forEach((nd) => {
        const parentId = parentChildMap.get(nd.id)
        if (parentId) {
            if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, [])
            childrenByParent.get(parentId).push(nd)
        }
    })
    const radius3 = 100
    childrenByParent.forEach((children, parentId) => {
        const parent = positionedNodes.find((n) => n.id === parentId)
        if (!parent || !parent.x || !parent.y) return
        const numC = children.length
        const angleStep3 = (2 * Math.PI) / Math.max(1, numC)
        children.forEach((nd, i) => {
            const angle = i * angleStep3 + (Math.random() - 0.5) * angleStep3 * 0.2 // small jitter
            nd.x = parent.x + Math.cos(angle) * radius3
            nd.y = parent.y + Math.sin(angle) * radius3
        })
    })
    // Orphan layer3
    const orphanL3 = layer3Datas.filter((nd) => !parentChildMap.has(nd.id))
    if (orphanL3.length > 0) {
        const outerRadius = radius2 + 150
        orphanL3.forEach((nd, i) => {
            const angle = i * ((2 * Math.PI) / orphanL3.length)
            nd.x = Math.cos(angle) * outerRadius
            nd.y = Math.sin(angle) * outerRadius
        })
    }
    return positionedNodes
}

function computeMetrics(transactions, wallets) {
    const allTxs = transactions
    const getTime = (bt) => {
        if (typeof bt === 'number') return bt * 1000
        if (typeof bt === 'string' || bt instanceof Date) return new Date(bt).getTime()
        return null
    }
    const times = allTxs
        .map((tx) => getTime(tx.block_time))
        .filter((t) => t !== null)
        .sort((a, b) => a - b)
    let velocity = 0
    if (times.length > 1) {
        const timeSpanDays = (times[times.length - 1] - times[0]) / (1000 * 60 * 60 * 24)
        velocity = allTxs.length / Math.max(timeSpanDays, 1)
    } else if (times.length === 1) {
        velocity = 1
    }
    const tokenKeys = allTxs.map(
        (tx) => tx.contractAddress?.toLowerCase() || tx.tokenSymbol?.toLowerCase() || 'unknown',
    )
    const uniqueTokens = new Set(tokenKeys).size
    const volumes = allTxs.reduce((acc, tx) => {
        const key = tx.contractAddress?.toLowerCase() || tx.tokenSymbol?.toLowerCase() || 'unknown'
        acc[key] = (acc[key] || 0) + Number(tx.usdValue || tx.value || 0)
        return acc
    }, {})
    const topTokensVolume = Object.entries(volumes)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
    const totalValue = wallets.reduce((sum, w) => sum + parseFloat(w.totalValue || 0), 0)
    const values = allTxs.map((tx) => Number(tx.usdValue || tx.value || 0))
    let outstandingTxs = []
    if (values.length > 0) {
        const mean = values.reduce((a, b) => a + b, 0) / values.length
        const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length
        const std = Math.sqrt(variance)
        const threshold = mean + 2 * std
        outstandingTxs = allTxs
            .filter(
                (tx) =>
                    Number(tx.usdValue || tx.value || 0) > threshold ||
                    Number(tx.usdValue || tx.value || 0) > totalValue * 0.1,
            )
            .sort((a, b) => Number(b.usdValue || b.value || 0) - Number(a.usdValue || a.value || 0))
            .slice(0, 3)
    }
    return { velocity, uniqueTokens, topTokensVolume, outstandingTxs, totalValue }
}

function simpleRuleBasedClustering(nodesData, edgesData) {
    const clusters = []
    const nodeMap = new Map(nodesData.map((n) => [n.id.toLowerCase(), n]))
    const adjList = new Map()
    nodesData.forEach((n) => adjList.set(n.id.toLowerCase(), new Set()))
    edgesData.forEach((e) => {
        adjList.get(e.source.toLowerCase())?.add(e.target.toLowerCase())
        adjList.get(e.target.toLowerCase())?.add(e.source.toLowerCase())
    })
    // Compute per-node metrics for better labeling
    nodesData.forEach((node) => {
        const nodeTxs = edgesData.filter(
            (e) =>
                e.source.toLowerCase() === node.id.toLowerCase() ||
                e.target.toLowerCase() === node.id.toLowerCase(),
        )
        node.degree = adjList.get(node.id.toLowerCase())?.size || 0
        node.txCount = node.txCount || nodeTxs.length
        const times = nodeTxs
            .map((e) =>
                typeof e.block_time === 'number' ? e.block_time * 1000 : new Date(e.block_time).getTime(),
            )
            .filter((t) => t)
            .sort((a, b) => a - b)
        let velocity = 0
        if (times.length > 1) {
            const spanDays = (times[times.length - 1] - times[0]) / 86400000
            velocity = times.length / Math.max(spanDays, 1)
        }
        node.velocity = velocity
        const uniqueTokens = new Set(nodeTxs.map((e) => e.tokenSymbol || 'unknown')).size
        node.uniqueTokens = uniqueTokens
        // Enhanced rule-based autoLabel - Only assign for Institution, Whale, Exchange, NFT Collector
        let autoLabel = null
        const totalValue = parseFloat(node.totalValue || 0)
        const txCount = node.txCount || 0
        const degree = node.degree || 0
        if (degree > 20 || txCount > 500) autoLabel = 'Exchange'
        else if (totalValue > 1000000) autoLabel = 'Whale'
        else if (totalValue > 100000 && degree > 8 && velocity < 1.5) autoLabel = 'Institution'
        else if (uniqueTokens >= 30) autoLabel = 'NFT Collector'
        node.autoLabel = autoLabel
    })
    // Simple: Group by shared label (nametag) or high degree (>3), add auto-label preview only if applicable
    const groups = new Map()
    nodesData.forEach((node) => {
        const key =
            node.label !== 'Unknown'
                ? node.label
                : node.autoLabel
                    ? `auto_${node.autoLabel}_${node.degree > 3 ? 'hub' : 'solo'}`
                    : truncateAddress(node.id)
        if (!groups.has(key))
            groups.set(key, { wallets: [], transactions: [], autoLabel: node.autoLabel })
        groups.get(key).wallets.push({ ...node, autoLabel: node.autoLabel }) // Add to node
    })
    // Assign tx (simple: all to group if connected)
    edgesData.forEach((edge) => {
        const sourceKey = [...groups.entries()].find(([k, g]) =>
            g.wallets.some((w) => w.id.toLowerCase() === edge.source.toLowerCase()),
        )?.[0]
        if (sourceKey) groups.get(sourceKey).transactions.push({ ...edge })
    })
    groups.forEach((group, key) => {
        if (
            group.wallets.length >= 2 &&
            group.wallets.some((w) => w.label !== 'Unknown' || w.autoLabel)
        ) {
            const cluster = {
                clusterId: key,
                nametag: key,
                wallets: group.wallets,
                transactions: [...new Set(group.transactions.map(JSON.stringify))].map(JSON.parse),
                riskScore: 0.3, // Default low
                autoLabel: group.autoLabel || null, // Preview only if applicable
            }
            const metrics = computeMetrics(cluster.transactions, cluster.wallets)
            clusters.push({ ...cluster, ...metrics })
        }
    })
    return clusters
}

// === Worker handler ===
self.onmessage = async (e) => {
    const { type, data } = e.data
    let result

    try {
        if (type === 'aggregate') {
            result = aggregateWallets(
                data.incomingData,
                data.outgoingData,
                data.layer3Data,
                data.rootAddress,
                data.page,
                data.filterType,
                data.rootNametag,
                data.rootImage
            )
        } else if (type === 'position') {
            result = computePositionedNodes(data.nodes, data.edges)
        } else if (type === 'computeMetrics') {
            result = computeMetrics(data.transactions, data.wallets)
        } else if (type === 'cluster') {
            result = simpleRuleBasedClustering(data.nodes, data.edges)
        } else {
            throw new Error('Unknown worker type')
        }

        self.postMessage({ result })
    } catch (err) {
        self.postMessage({ error: err.message })
    }
}