// utils/imageWorker.js

export function imageWorker(edges, selectedChain, apiBaseUrl, preloadImages = []) {
  return new Promise((resolve, reject) => {
    const workerCode = `
      const fetchTokenImages = async (edges, selectedChain, apiBaseUrl, preloadImages) => {
        if (preloadImages.length > 0) {
          const imageCache = {};
          await Promise.all(preloadImages.map(async url => {
            try {
              const response = await fetch(url);
              if (response.ok) {
                imageCache[url] = url; // Lưu URL thay vì image object vì worker không có canvas
              }
            } catch {}
          }));
          return imageCache;
        }
        const uniqueTokens = [
          ...new Set([
            ...edges.flatMap((edge) => edge.data.contractAddress?.toLowerCase()),
            ...edges.flatMap((edge) => edge.data.tokenSymbol?.toLowerCase()),
          ]),
        ].filter(Boolean);
        const tokenInfo = {};
        edges.forEach((edge) => {
          const tokenKey = edge.data.contractAddress?.toLowerCase() || edge.data.tokenSymbol?.toLowerCase();
          if (edge.data.tokenSymbol?.toLowerCase() === 'eth' && selectedChain === '1') {
            tokenInfo[tokenKey] = {
              image: 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png?1696501628',
              symbol: 'ETH'
            };
          }
          if (selectedChain === 'bitcoin' && edge.data.tokenSymbol?.toLowerCase() === 'btc') {
            tokenInfo[tokenKey] = {
              image: '/logos/bitcoin.webp',
              symbol: 'BTC'
            };
          } else if (edge.data.tokenImage && edge.data.tokenImage !== '/icons/default.webp') {
            tokenInfo[tokenKey] = {
              image: edge.data.tokenImage,
              symbol: edge.data.tokenSymbol?.toUpperCase() || 'UNKNOWN'
            };
          }
        });
        const tokensToFetch = uniqueTokens.filter((token) => !tokenInfo[token] && selectedChain !== 'bitcoin');
        const concurrencyLimit = 10;
        const fetchBatch = async (batch) => {
          const batchPromises = batch.map(async (token) => {
            if (!token) return;
            try {
              const cacheResponse = await fetch(\`\${apiBaseUrl}/api/cache?key=token_image_\${token}\`);
              const cacheResult = await cacheResponse.json();
              if (cacheResponse.ok && cacheResult.success && cacheResult.data?.image) {
                const symbol = cacheResult.data?.symbol || (token.match(/^[0x]/i) ? undefined : token.toUpperCase());
                tokenInfo[token] = { image: cacheResult.data.image, symbol };
                return;
              }
              const isContractAddress = token.match(/^[0x]/i);
              const queryParam = isContractAddress ? \`contractAddress=\${token}\` : \`symbol=\${token}\`;
              const dbResponse = await fetch(\`\${apiBaseUrl}/api/tokens?\${queryParam}&chain=\${selectedChain}\`);
              const dbResult = await dbResponse.json();
              if (dbResponse.ok && dbResult.success && dbResult.data?.image) {
                const symbol = dbResult.data.symbol?.toUpperCase() || token.toUpperCase();
                tokenInfo[token] = { image: dbResult.data.image, symbol };
                await fetch(\`\${apiBaseUrl}/api/cache\`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    key: \`token_image_\${token}\`,
                    action: 'set',
                    data: { image: dbResult.data.image, symbol: dbResult.data.symbol },
                    ttl: 4 * 3600 * 1000,
                  }),
                });
                return;
              }
              const cgResponse = await fetch(
                \`\${apiBaseUrl}/api/coingecko?action=token-details&\${queryParam}&chain=\${selectedChain}\`
              );
              const cgResult = await cgResponse.json();
              if (cgResponse.ok && cgResult.success && cgResult.data?.image?.thumb) {
                const symbol = cgResult.data.symbol?.toUpperCase() || token.toUpperCase();
                tokenInfo[token] = { image: cgResult.data.image.thumb, symbol };
                await fetch(\`\${apiBaseUrl}/api/cache\`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    key: \`token_image_\${token}\`,
                    action: 'set',
                    data: { image: cgResult.data.image.thumb, symbol: cgResult.data.symbol },
                    ttl: 4 * 3600 * 1000,
                  }),
                });
                if (isContractAddress) {
                  await fetch(\`\${apiBaseUrl}/api/tokens\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      action: 'update',
                      coingecko_id: cgResult.data.id || token,
                      symbol: cgResult.data.symbol || token,
                      name: cgResult.data.name || token,
                      image: cgResult.data.image.thumb,
                      chain: selectedChain,
                      contractAddress: token,
                    }),
                  });
                }
                return;
              } else {
                tokenInfo[token] = { image: '/icons/default.webp', symbol: token.toUpperCase() };
              }
            } catch (err) {
              tokenInfo[token] = { image: '/icons/default.webp', symbol: token.toUpperCase() };
            }
          });
          await Promise.all(batchPromises);
        };
        for (let i = 0; i < tokensToFetch.length; i += concurrencyLimit) {
          const batch = tokensToFetch.slice(i, i + concurrencyLimit);
          await fetchBatch(batch);
        }
        return tokenInfo;
      };
      self.onmessage = async (e) => {
        const { edges, selectedChain, apiBaseUrl, preloadImages } = e.data;
        const result = await fetchTokenImages(edges, selectedChain, apiBaseUrl, preloadImages || []);
        self.postMessage(result);
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));
    worker.postMessage({ edges, selectedChain, apiBaseUrl, preloadImages });
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