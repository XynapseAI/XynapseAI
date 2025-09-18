// scripts/preprocess-cluster-embeddings.js
import 'dotenv/config'; // Load environment variables from .env
import { pipeline } from '@xenova/transformers';
import { query } from '../utils/postgres.js';
import { createClient } from 'redis';

async function preprocessClusterEmbeddings() {
  const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  await redisClient.connect();

  // Load MiniLM-L6-v2 model
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  // Fetch unique cluster names
  const result = await query(`
    SELECT DISTINCT COALESCE(normalized_cluster_name, normalize_cluster_name(exchange_name)) AS cluster_name
    FROM wallet_holders
  `);
  const clusterNames = result.rows.map(row => row.cluster_name);

  // Compute embeddings
  for (const name of clusterNames) {
    const output = await embedder(name, { pooling: 'mean', normalize: true });
    const embedding = Array.from(output.data); // 384-dimensional vector

    // Store embedding in Redis for caching
    await redisClient.set(`embedding:${name}`, JSON.stringify(embedding), { EX: 24 * 60 * 60 });

    // Update database with JSONB embedding
    await query(`
      UPDATE wallet_holders
      SET cluster_embedding = $1::JSONB
      WHERE COALESCE(normalized_cluster_name, normalize_cluster_name(exchange_name)) = $2
    `, [JSON.stringify(embedding), name]);
  }

  await redisClient.quit();
}

preprocessClusterEmbeddings().catch(console.error);