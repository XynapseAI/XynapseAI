// lib/nametags.js
import { db } from '../utils/firebaseAdmin.js'; // Import Firestore instance
import admin from 'firebase-admin'; // For FieldPath.documentId()
import pkg from '../utils/logger.cjs';

const { logger } = pkg;
const NAMETAGS_COLLECTION = 'nametags';
let GLOBAL_NAMETAGS_CACHE = {}; // In-memory cache for nametags

/**
 * Loads all nametags from Firestore into the in-memory cache.
 * This is called on module initialization (cold start) or explicitly.
 * @returns {Promise<object>} The loaded nametags cache.
 */
export async function loadAllNametags() {
    logger.info("Loading all nametags from Firestore...");
    try {
        const snapshot = await db.collection(NAMETAGS_COLLECTION).get();
        const tempNametags = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            // Assuming each document ID is the address and data contains the Labels structure
            tempNametags[doc.id.toLowerCase()] = data; // Store the full data object
        });
        GLOBAL_NAMETAGS_CACHE = tempNametags; // Update global cache
        logger.info(`Loaded ${Object.keys(GLOBAL_NAMETAGS_CACHE).length} nametags from Firestore.`);
        return GLOBAL_NAMETAGS_CACHE; // Return the loaded cache
    } catch (e) {
        logger.error(`Error loading all nametags from Firestore: ${e.message}`);
        return {};
    }
}

/**
 * Retrieves a nametag for a given wallet address,
 * checking in-memory cache first, then Firestore.
 * @param {string} walletAddress - The blockchain address.
 * @returns {Promise<string>} The name tag or 'Unknown' if not found.
 */
export async function getNametag(walletAddress) {
    const normalizedAddress = walletAddress.toLowerCase();
    if (GLOBAL_NAMETAGS_CACHE[normalizedAddress]) {
        const data = GLOBAL_NAMETAGS_CACHE[normalizedAddress];
        if (data && data.Labels) {
            const firstLabelKey = Object.keys(data.Labels)[0];
            return data.Labels[firstLabelKey]?.['Name Tag'] || 'Unknown';
        }
    }

    // Try to fetch from Firestore if not in memory cache
    try {
        const docRef = db.collection(NAMETAGS_COLLECTION).doc(normalizedAddress);
        const doc = await docRef.get();
        if (doc.exists) {
            const nametagData = doc.data();
            GLOBAL_NAMETAGS_CACHE[normalizedAddress] = nametagData; // Add to in-memory cache
            if (nametagData && nametagData.Labels) {
                const firstLabelKey = Object.keys(nametagData.Labels)[0];
                return nametagData.Labels[firstLabelKey]?.['Name Tag'] || 'Unknown';
            }
        }
    } catch (e) {
        logger.error(`Error fetching nametag for ${walletAddress} from Firestore: ${e.message}`);
    }

    return 'Unknown';
}

/**
 * Adds or updates a nametag in Firestore.
 * @param {string} walletAddress - The blockchain address.
 * @param {object} labelsData - The labels data for the nametag.
 * @param {string|null} originalAddressField - Optional: Original address field if different from walletAddress.
 */
export async function addNametag(walletAddress, labelsData, originalAddressField = null) { // eslint-disable-line @typescript-eslint/no-unused-vars
    const normalizedAddress = walletAddress.toLowerCase();

    let finalLabels = {};
    if (labelsData && typeof labelsData === 'object' && !Array.isArray(labelsData)) {
        finalLabels = labelsData;
    } else {
        // Fallback for older structure if only nameTag, imageUrl, category were provided.
        // You should ideally send a structured `labelsData` from your API route.
        const firstLabelKey = "0";
        finalLabels[firstLabelKey] = {
            "Name Tag": labelsData?.nameTag || 'Unknown',
            "image": labelsData?.imageUrl || '/icons/default.png',
            "category": labelsData?.category || 'Manual Tag',
            "description": labelsData?.description || "",
            "first_seen": labelsData?.first_seen || new Date().toISOString()
        };
    }

    const newNametagEntry = {
        Labels: finalLabels,
        last_updated: new Date().toISOString()
    };
    try {
        await db.collection(NAMETAGS_COLLECTION).doc(normalizedAddress).set(newNametagEntry, { merge: true });
        GLOBAL_NAMETAGS_CACHE[normalizedAddress] = newNametagEntry;
        logger.info(`Added/Updated nametag for ${walletAddress} in Firestore with full Labels structure.`);
    } catch (e) {
        logger.error(`Error saving nametag for ${walletAddress} to Firestore: ${e.message}`);
    }
}

/**
 * Fetches a batch of nametags from Firestore, prioritizing in-memory cache.
 * @param {string[]} addresses - An array of wallet addresses to fetch nametags for.
 * @returns {Promise<object>} An object mapping wallet addresses to their full nametag data.
 */
export async function getNametagsBatch(addresses) {
    const normalizedAddresses = addresses.map(addr => addr.toLowerCase());
    const foundNametags = {};
    const notFoundAddresses = [];

    // First, check in-memory cache
    for (const addr of normalizedAddresses) {
        if (GLOBAL_NAMETAGS_CACHE[addr]) {
            foundNametags[addr] = GLOBAL_NAMETAGS_CACHE[addr];
        } else {
            notFoundAddresses.push(addr);
        }
    }

    // If there are addresses not in cache, fetch from Firestore in batches
    if (notFoundAddresses.length > 0) {
        logger.info(`Fetching ${notFoundAddresses.length} nametags from Firestore that are not in cache.`);
        const batchSize = 10; // Firestore limit for 'in' query is 10
        for (let i = 0; i < notFoundAddresses.length; i += batchSize) {
            const batch = notFoundAddresses.slice(i, i + batchSize);
            try {
                // Using FieldPath.documentId() for querying by document ID
                const snapshot = await db.collection(NAMETAGS_COLLECTION).where(admin.firestore.FieldPath.documentId(), 'in', batch).get();
                snapshot.forEach(doc => {
                    const data = doc.data();
                    GLOBAL_NAMETAGS_CACHE[doc.id.toLowerCase()] = data; // Update in-memory cache
                    foundNametags[doc.id.toLowerCase()] = data;
                });
            } catch (e) {
                logger.error(`Error fetching nametag batch from Firestore: ${e.message}`);
            }
        }
    }
    return foundNametags;
}

// Initial load: This will run on cold starts.
// For cron jobs, which are new invocations, this helps prime the cache.
loadAllNametags();