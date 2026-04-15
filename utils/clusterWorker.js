// utils/clusterWorker.js
let workerInstance = null

function getWorker() {
  if (!workerInstance) {
    workerInstance = new Worker('/workers/clusterWorker.js')
  }
  return workerInstance
}

// 4 hàm export mới (sử dụng chung 1 worker)
export function aggregateInWorker(incomingData, outgoingData, layer3Data, rootAddress, page, filterType, rootNametag = 'Unknown', rootImage = '/icons/default.webp') {
  return new Promise((resolve, reject) => {
    const worker = getWorker()
    worker.postMessage({
      type: 'aggregate',
      data: { incomingData, outgoingData, layer3Data, rootAddress, page, filterType, rootNametag, rootImage }
    })
    worker.onmessage = (e) => {
      if (e.data.error) reject(new Error(e.data.error))
      else resolve(e.data.result)
    }
  })
}

export function positionInWorker(nodes, edges) {
  return new Promise((resolve, reject) => {
    const worker = getWorker()
    worker.postMessage({ type: 'position', data: { nodes, edges } })
    worker.onmessage = (e) => {
      if (e.data.error) reject(new Error(e.data.error))
      else resolve(e.data.result)
    }
  })
}

export function computeMetricsInWorker(transactions, wallets) {
  return new Promise((resolve, reject) => {
    const worker = getWorker()
    worker.postMessage({ type: 'computeMetrics', data: { transactions, wallets } })
    worker.onmessage = (e) => {
      if (e.data.error) reject(new Error(e.data.error))
      else resolve(e.data.result)
    }
  })
}

export function clusterInWorker(nodes, edges) {
  return new Promise((resolve, reject) => {
    const worker = getWorker()
    worker.postMessage({ type: 'cluster', data: { nodes, edges } })
    worker.onmessage = (e) => {
      if (e.data.error) reject(new Error(e.data.error))
      else resolve(e.data.result)
    }
  })
}