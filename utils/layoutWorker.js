// utils/layoutWorker.js

export function layoutInWorker(nodesData, edgesData) {
  return new Promise((resolve, reject) => {
    const workerCode = `
      const layoutNodes = (nodesData, edgesData) => {
        const positionedNodes = nodesData.map(n => ({ ...n }));
        const rootData = positionedNodes.find(n => n.isRoot);
        if (rootData) {
          rootData.x = 0;
          rootData.y = 0;
          rootData.fx = rootData.x;
          rootData.fy = rootData.y;
        }
        const layer2Datas = positionedNodes.filter(n => n.layer === 2);
        const radius2 = 250;
        const numL2 = layer2Datas.length;
        if (numL2 > 0) {
          const angleStep = 2 * Math.PI / numL2;
          layer2Datas.forEach((nd, i) => {
            const angle = i * angleStep;
            nd.x = Math.cos(angle) * radius2;
            nd.y = Math.sin(angle) * radius2;
          });
        }
        const layer3Datas = positionedNodes.filter(n => n.layer === 3);
        const parentChildMap = new Map(); // childId -> parentId
        const graphLinksTemp = edgesData.map(e => ({ ...e })); // Temp for positioning
        graphLinksTemp.forEach(link => {
          if (link.layer === 3) {
            const ids = [link.source, link.target];
            const l2id = positionedNodes.find(n => n.id === ids[0] && n.layer === 2)?.id || positionedNodes.find(n => n.id === ids[1] && n.layer === 2)?.id;
            if (l2id) {
              const childId = ids[0] === l2id ? ids[1] : ids[0];
              parentChildMap.set(childId, l2id);
            }
          }
        });
        const childrenByParent = new Map();
        layer3Datas.forEach(nd => {
          const parentId = parentChildMap.get(nd.id);
          if (parentId) {
            if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
            childrenByParent.get(parentId).push(nd);
          }
        });
        const radius3 = 100;
        childrenByParent.forEach((children, parentId) => {
          const parent = positionedNodes.find(n => n.id === parentId);
          if (!parent || !parent.x || !parent.y) return;
          const numC = children.length;
          const angleStep3 = 2 * Math.PI / Math.max(1, numC);
          children.forEach((nd, i) => {
            const angle = i * angleStep3 + (Math.random() - 0.5) * angleStep3 * 0.2; // small jitter
            nd.x = parent.x + Math.cos(angle) * radius3;
            nd.y = parent.y + Math.sin(angle) * radius3;
          });
        });
        // Orphan layer3
        const orphanL3 = layer3Datas.filter(nd => !parentChildMap.has(nd.id));
        if (orphanL3.length > 0) {
          const outerRadius = radius2 + 150;
          orphanL3.forEach((nd, i) => {
            const angle = i * (2 * Math.PI / orphanL3.length);
            nd.x = Math.cos(angle) * outerRadius;
            nd.y = Math.sin(angle) * outerRadius;
          });
        }
        return positionedNodes;
      };
      self.onmessage = (e) => {
        const { nodesData, edgesData } = e.data;
        const result = layoutNodes(nodesData, edgesData);
        self.postMessage(result);
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));
    worker.postMessage({ nodesData, edgesData });
    worker.onmessage = (e) => {
      resolve(e.data);
      worker.terminate();
    };
    worker.onerror = (err) => {
      reject(err);
      worker.terminate();
    };
  });
}