// pages/api/get-transactions.js
import { query } from '../../utils/postgres.js';
import { fetchBlockchainData } from '../../lib/blockchainData.js';
import { getNametagsBatch } from '../../lib/nametags.js'; // Import từ lib/nametags.js
import { isAddress } from 'ethers';
import pkg from '../../utils/logger.cjs';

const { logger } = pkg;

async function verifyApiKey(apiKey) {
  try {
    const result = await query(
      `SELECT active, expires_at FROM api_keys WHERE api_key = $1`,
      [apiKey]
    );
    if (result.rows.length === 0) {
      logger.warn(`Invalid API key: ${apiKey}`);
      return false;
    }
    const { active, expires_at } = result.rows[0];
    if (!active || new Date(expires_at) < new Date()) {
      logger.warn(`API key ${apiKey} is inactive or expired`);
      return false;
    }
    return true;
  } catch (error) {
    logger.error(`Error verifying API key: ${error.message}`, { stack: error.stack });
    return false;
  }
}

async function getNametagsBatchWithAnalysis(addresses) {
  const uniqueAddresses = [...new Set(addresses.map(addr => addr.toLowerCase()).filter(isAddress))];
  const nametags = {};

  if (uniqueAddresses.length === 0) {
    logger.info('No valid addresses provided for batch nametag fetch.');
    return nametags;
  }

  try {
    // Lấy nametags từ bảng nametags
    const nametagsResult = await getNametagsBatch(uniqueAddresses);
    Object.assign(nametags, nametagsResult);

    // Lấy nametags từ bảng wallet_analysis cho các địa chỉ chưa có nametag hợp lệ
    const remainingAddresses = uniqueAddresses.filter(addr => !nametags[addr] || nametags[addr].name === 'Unknown');
    if (remainingAddresses.length > 0) {
      logger.info(`Fetching from wallet_analysis for ${remainingAddresses.length} remaining addresses: ${remainingAddresses.join(', ')}`);
      const batchSize = 100;
      for (let i = 0; i < remainingAddresses.length; i += batchSize) {
        const batchAddresses = remainingAddresses.slice(i, i + batchSize);
        const analysisResult = await query(
          `SELECT wallet, nametag, image FROM wallet_analysis WHERE wallet = ANY($1)`,
          [batchAddresses]
        );
        analysisResult.rows.forEach(row => {
          const nametag = row.nametag || 'Unknown';
          let image = row.image || '/icons/default.png';
          if (nametag !== 'Unknown' && !image) {
            const shortName = nametag.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
            image = `/icons/${shortName}.png`;
          }
          nametags[row.wallet.toLowerCase()] = {
            address: row.wallet.toLowerCase(),
            name: nametag,
            image: image,
            description: '',
            subcategory: 'Others'
          };
        });
      }
    }

    // Gán mặc định cho các địa chỉ không tìm thấy
    uniqueAddresses.forEach(addr => {
      if (!nametags[addr]) {
        nametags[addr] = {
          address: addr,
          name: 'Unknown',
          image: '/icons/default.png',
          description: '',
          subcategory: 'Others'
        };
      }
    });

    logger.info(`Total nametags fetched: ${Object.keys(nametags).length}, Unknown: ${Object.values(nametags).filter(tag => tag.name === 'Unknown').length}`);
    return nametags;
  } catch (error) {
    logger.error(`Error fetching nametags batch: ${error.message}`, { stack: error.stack });
    return uniqueAddresses.reduce((acc, addr) => ({
      ...acc,
      [addr]: {
        address: addr,
        name: 'Unknown',
        image: '/icons/default.png',
        description: '',
        subcategory: 'Others'
      }
    }), {});
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    logger.error(`Method not allowed: ${req.method}`);
    return res.status(405).json({ error: 'Method not allowed. Only POST is supported.' });
  }

  const { wallet_address, chain = 'ethereum' } = req.body;

  if (!isAddress(wallet_address)) {
    logger.error(`Invalid wallet address: ${wallet_address}`);
    return res.status(400).json({ error: 'Wallet address is required and must be valid.' });
  }

  const lowerWalletAddress = wallet_address.toLowerCase();

  try {
    const apiKey = process.env.INTERNAL_API_TOKEN;
    if (!apiKey) {
      logger.error('Missing INTERNAL_API_TOKEN in environment variables');
      return res.status(401).json({ error: 'Unauthorized: Missing API key.' });
    }
    if (!(await verifyApiKey(apiKey))) {
      logger.error(`Invalid API key: ${apiKey}`);
      return res.status(401).json({ error: 'Unauthorized: Invalid API key.' });
    }

    logger.info(`Fetching transactions for ${lowerWalletAddress} on ${chain}...`);
    const txData = await fetchBlockchainData(lowerWalletAddress, 'transactions', false, 100, chain);

    const uniqueTxData = Array.from(new Map(txData.map((tx) => [tx.hash, tx])).values());

    const incomingTxs = uniqueTxData
      .filter((tx) => tx.to.toLowerCase() === lowerWalletAddress)
      .slice(0, 50);
    const outgoingTxs = uniqueTxData
      .filter((tx) => tx.from.toLowerCase() === lowerWalletAddress)
      .slice(0, 50);

    logger.info(`Fetching nametags for ${lowerWalletAddress} and related addresses...`);
    const allAddresses = [
      lowerWalletAddress,
      ...incomingTxs.map((tx) => tx.from.toLowerCase()),
      ...outgoingTxs.map((tx) => tx.to.toLowerCase()),
    ];
    const nametags = await getNametagsBatchWithAnalysis(allAddresses);

    const incomingTxsWithNametags = incomingTxs.map((tx) => ({
      hash: tx.hash,
      from: tx.from.toLowerCase(),
      to: tx.to.toLowerCase(),
      value: (parseInt(String(tx.value), 16) / 1e18).toFixed(6),
      block_time: tx.block_time,
      type: 'incoming',
      from_nametag: nametags[tx.from.toLowerCase()]?.name || 'Unknown',
      from_image: nametags[tx.from.toLowerCase()]?.image || '/icons/default.png',
      to_nametag: nametags[tx.to.toLowerCase()]?.name || 'Unknown',
      to_image: nametags[tx.to.toLowerCase()]?.image || '/icons/default.png',
    }));

    const outgoingTxsWithNametags = outgoingTxs.map((tx) => ({
      hash: tx.hash,
      from: tx.from.toLowerCase(),
      to: tx.to.toLowerCase(),
      value: (parseInt(String(tx.value), 16) / 1e18).toFixed(6),
      block_time: tx.block_time,
      type: 'outgoing',
      from_nametag: nametags[tx.from.toLowerCase()]?.name || 'Unknown',
      from_image: nametags[tx.from.toLowerCase()]?.image || '/icons/default.png',
      to_nametag: nametags[tx.to.toLowerCase()]?.name || 'Unknown',
      to_image: nametags[tx.to.toLowerCase()]?.image || '/icons/default.png',
    }));

    const walletInfo = {
      address: lowerWalletAddress,
      nametag: nametags[lowerWalletAddress]?.name || 'Unknown',
      image: nametags[lowerWalletAddress]?.image || '/icons/default.png',
    };

    logger.info(`Fetched ${incomingTxsWithNametags.length} incoming and ${outgoingTxsWithNametags.length} outgoing transactions for ${lowerWalletAddress}`);
    return res.status(200).json({
      incoming: incomingTxsWithNametags,
      outgoing: outgoingTxsWithNametags,
      wallet: walletInfo,
    });
  } catch (err) {
    logger.error(`Error fetching transactions for ${lowerWalletAddress}: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ error: `Failed to fetch transactions: ${err.message}` });
  }
}