// lib/blockchainData.js
import axios from 'axios';
import { db } from '../utils/firebaseAdmin'; // Import Firestore instance
import { isAddress } from 'ethers'; // For address validation
import { logger } from '../utils/logger'; // Using a logger for better insights

const CACHE_COLLECTION = 'blockchain_cache';
const ETHERSCAN_API_BASE_URL = process.env.NEXTAUTH_URL + '/api/etherscan'; // Use your Next.js API Route

// Helper to convert BigInt hex to decimal string for value
const convertWeiToHex = (weiValue) => {
    if (weiValue === null || weiValue === undefined) return '0x0';
    try {
        const bigIntValue = BigInt(weiValue);
        return '0x' + bigIntValue.toString(16);
    } catch (e) {
        logger.warn(`Error converting wei to hex: ${weiValue}, defaulting to 0x0. Error: ${e.message}`);
        return '0x0';
    }
};

/**
 * Fetches blockchain data (e.g., transactions) for a given wallet address.
 * Uses Firestore cache to reduce external API calls.
 * @param {string} walletAddress - The blockchain address to fetch data for.
 * @param {string} action - The type of data to fetch (e.g., 'transactions').
 * @param {boolean} forceRefresh - If true, bypasses cache and fetches new data.
 * @param {number} limit - The maximum number of records to return.
 * @param {string} chain - The blockchain chain (e.g., 'ethereum').
 * @returns {Promise<Array>} An array of blockchain data records.
 */
export async function fetchBlockchainData(walletAddress, action = 'transactions', forceRefresh = false, limit = 500, chain = 'ethereum') {
    if (!isAddress(walletAddress)) {
        logger.error(`Invalid wallet address: ${walletAddress}`);
        return [];
    }
    const lowerWalletAddress = walletAddress.toLowerCase();
    const docId = `${lowerWalletAddress}_${action}_${chain}`;
    const cacheRef = db.collection(CACHE_COLLECTION).doc(docId);

    if (!forceRefresh) {
        try {
            const doc = await cacheRef.get();
            if (doc.exists) {
                const cachedData = doc.data().data;
                logger.info(`Using cached data for ${lowerWalletAddress} (${action}, ${chain}): ${cachedData.length} records.`);
                return cachedData.slice(0, limit);
            }
        } catch (e) {
            logger.error(`Error reading cache from Firestore for ${docId}: ${e.message}`);
            // Fall through to fetch new data if cache read fails
        }
    }

    try {
        logger.info(`Fetching ${action} for ${lowerWalletAddress} on chain ${chain} via API (limit: ${limit}).`);

        const payload = {
            action: action,
            address: lowerWalletAddress,
            chain: chain
        };

        const response = await axios.post(ETHERSCAN_API_BASE_URL, payload, {
            headers: {
                'Content-Type': 'application/json',
                'X-Internal-Token': process.env.INTERNAL_API_TOKEN // Use internal token for security
            },
            timeout: 30000 // Increased timeout for API calls
        });

        if (response.status !== 200 || !response.data.success) {
            logger.error(`Etherscan API returned error: ${response.data.detail || 'Unknown error'}`);
            return [];
        }

        let data = response.data.data || [];

        if (action === 'transactions') {
            // Map Etherscan specific fields to desired format
            data = data.map(tx => ({
                chain: tx.chain,
                hash: tx.hash,
                from: tx.from,
                to: tx.to,
                value: convertWeiToHex(tx.value), // Ensure value is hex string
                block_time: tx.block_time, // Assuming this is already ISO string from Etherscan API route
                gasUsed: tx.gasUsed,
                gasPrice: tx.gasPrice,
                input: tx.input,
                isError: tx.isError,
            }));
            // Sort by block_time in descending order (newest first)
            data.sort((a, b) => new Date(b.block_time).getTime() - new Date(a.block_time).getTime());
            data = data.slice(0, limit); // Apply limit after sorting
        }

        // Save to cache
        await cacheRef.set({
            data: data,
            timestamp: new Date().toISOString()
        });
        logger.info(`Fetched and cached ${data.length} ${action} for ${lowerWalletAddress} (${chain}).`);
        return data;

    } catch (e) {
        logger.error(`Error fetching ${action} for ${lowerWalletAddress} on ${chain}: ${e.message}`);
        if (axios.isAxiosError(e) && e.response) {
            logger.error(`Response details: ${JSON.stringify(e.response.data)}`);
            if (e.response.status === 429) {
                logger.warn(`Rate limit hit for ${lowerWalletAddress} on ${chain}.`);
            }
        }
        return [];
    }
}