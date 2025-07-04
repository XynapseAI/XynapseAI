import vault from 'node-vault';
import NodeCache from 'node-cache';

const vaultClient = vault({
  apiVersion: 'v1',
  endpoint: process.env.VAULT_ENDPOINT || 'http://31.97.76.226:8200',
  token: process.env.VAULT_TOKEN,
});

const cache = new NodeCache({ stdTTL: 3600 }); // Cache secrets for 1 hour

async function getSecrets() {
  const cacheKey = 'vault_secrets';
  const cachedSecrets = cache.get(cacheKey);
  if (cachedSecrets) {
    console.log('Returning cached Vault secrets');
    return cachedSecrets;
  }

  try {
    if (!process.env.VAULT_TOKEN) {
      throw new Error('VAULT_TOKEN is not configured');
    }
    const result = await vaultClient.read('secret/data/xynapseai');
    const secrets = result.data;
    cache.set(cacheKey, secrets);
    console.log('Successfully fetched secrets from Vault');
    return secrets;
  } catch (error) {
    console.error('Error fetching secrets from Vault:', error.message);
    throw new Error(`Failed to fetch secrets from Vault: ${error.message}`);
  }
}

export { getSecrets };