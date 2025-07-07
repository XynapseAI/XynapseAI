// pages/api/get-transactions.js
import { logger } from '../../utils/logger.cjs';
import { db } from '../../utils/firebaseAdmin.js';
import { fetchBlockchainData } from '../../lib/blockchainData.js';
import { isAddress } from 'ethers';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const HMAC_SECRET = process.env.HMAC_SECRET;
const API_KEYS_COLLECTION = 'api_keys';
const NAMETAGS_COLLECTION = 'nametags';
const WALLET_ANALYSIS_COLLECTION = 'wallet_analysis';

async function verifyApiKey(apiKey) {
  try {
    const keyDoc = await db.collection(API_KEYS_COLLECTION).doc(apiKey).get();
    if (!keyDoc.exists) {
      logger.warn(`Invalid API key: ${apiKey}`);
      return false;
    }
    const { active, expiresAt } = keyDoc.data();
    if (!active || new Date(expiresAt) < new Date()) {
      logger.warn(`API key ${apiKey} is inactive or expired`);
      return false;
    }
    return true;
  } catch (error) {
    logger.error(`Error verifying API key: ${error.message}`, { stack: error.stack });
    return false;
  }
}

async function getNametagsBatch(addresses) {
  const uniqueAddresses = [...new Set(addresses.map((addr) => addr.toLowerCase()))];
  const nametags = {};
  try {
    const batchSize = 30;
    logger.info(`Fetching nametags for ${uniqueAddresses.length} unique addresses: ${uniqueAddresses.join(', ')}`);

    for (let i = 0; i < uniqueAddresses.length; i += batchSize) {
      const batchAddresses = uniqueAddresses.slice(i, i + batchSize);
      logger.info(`Processing batch of ${batchAddresses.length} addresses: ${batchAddresses.join(', ')}`);

      // Truy vấn collection nametags
      const nametagsSnapshot = await db
        .collection(NAMETAGS_COLLECTION)
        .where('__name__', 'in', batchAddresses)
        .get();
      logger.info(`Fetched ${nametagsSnapshot.size} documents from ${NAMETAGS_COLLECTION} for batch of ${batchAddresses.length} addresses`);
      nametagsSnapshot.forEach((doc) => {
        const data = doc.data();
        const nametag = data?.Labels?.uniswap?.['Name Tag'];
        const image = data?.Labels?.uniswap?.image;
        if (nametag && nametag !== 'Unknown') {
          nametags[doc.id] = { nametag, image: image || '/icons/default.png' };
          logger.info(`Found nametag in nametags for ${doc.id}: ${nametag}, image: ${image || '/icons/default.png'}`);
        } else {
          logger.info(`No valid nametag in nametags for ${doc.id}`);
        }
      });

      // Truy vấn collection wallet_analysis cho các địa chỉ còn lại
      const remainingAddresses = batchAddresses.filter((addr) => !nametags[addr] || nametags[addr].nametag === 'Unknown');
      if (remainingAddresses.length > 0) {
        logger.info(`Fetching from wallet_analysis for ${remainingAddresses.length} remaining addresses: ${remainingAddresses.join(', ')}`);
        const analysisSnapshot = await db
          .collection(WALLET_ANALYSIS_COLLECTION)
          .where('__name__', 'in', remainingAddresses)
          .get();
        logger.info(`Fetched ${analysisSnapshot.size} documents from ${WALLET_ANALYSIS_COLLECTION} for batch of ${remainingAddresses.length} addresses`);
        analysisSnapshot.forEach((doc) => {
          const data = doc.data();
          const nametag = data?.nametag;
          let image = data?.image;
          if (!image && nametag && nametag !== 'Unknown') {
            const shortName = nametag.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
            image = `/icons/${shortName}.png`;
          }
          if (nametag && nametag !== 'Unknown') {
            nametags[doc.id] = { nametag, image: image || '/icons/default.png' };
            logger.info(`Found nametag in wallet_analysis for ${doc.id}: ${nametag}, image: ${image || '/icons/default.png'}`);
          } else {
            logger.info(`No valid nametag in wallet_analysis for ${doc.id}`);
          }
        });
      }
    }

    // Gán 'Unknown' cho các địa chỉ không tìm thấy
    uniqueAddresses.forEach((addr) => {
      if (!nametags[addr]) {
        nametags[addr] = { nametag: 'Unknown', image: '/icons/default.png' };
        logger.info(`No nametag found for ${addr}, defaulting to 'Unknown' with image /icons/default.png`);
      }
    });

    logger.info(`Total nametags fetched: ${Object.keys(nametags).length}, Unknown: ${Object.values(nametags).filter((tag) => tag.nametag === 'Unknown').length}`);
    return nametags;
  } catch (error) {
    logger.error(`Error fetching nametags batch: ${error.message}`, { stack: error.stack });
    return uniqueAddresses.reduce((acc, addr) => ({ ...acc, [addr]: { nametag: 'Unknown', image: '/icons/default.png' } }), {});
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
    const apiKey = process.env.INTERNAL_API_KEY;
    if (!apiKey) {
      logger.error('Missing INTERNAL_API_KEY in environment variables');
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

    logger.info(`Fetching nametags for ${lowerWalletAddress}...`);
    const allAddresses = [
      lowerWalletAddress, // Thêm ví gốc
      ...incomingTxs.map((tx) => tx.from),
      ...outgoingTxs.map((tx) => tx.to),
    ];
    const nametags = await getNametagsBatch(allAddresses);

    const incomingTxsWithNametags = incomingTxs.map((tx) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: (parseInt(String(tx.value), 16) / 1e18).toFixed(6),
      block_time: tx.block_time,
      type: 'incoming',
      from_nametag: nametags[tx.from.toLowerCase()]?.nametag || 'Unknown',
      from_image: nametags[tx.from.toLowerCase()]?.image || '/icons/default.png',
    }));

    const outgoingTxsWithNametags = outgoingTxs.map((tx) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: (parseInt(String(tx.value), 16) / 1e18).toFixed(6),
      block_time: tx.block_time,
      type: 'outgoing',
      to_nametag: nametags[tx.to.toLowerCase()]?.nametag || 'Unknown',
      to_image: nametags[tx.to.toLowerCase()]?.image || '/icons/default.png',
    }));

    const walletInfo = {
      address: lowerWalletAddress,
      nametag: nametags[lowerWalletAddress]?.nametag || 'Unknown',
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