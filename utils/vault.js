import vault from 'node-vault';
import pkg from '../utils/logger.cjs';

const { logger } = pkg;

// Khởi tạo client Vault
const vaultClient = vault({
  endpoint: process.env.VAULT_ADDR || 'http://localhost:8200', // Địa chỉ Vault server
  token: process.env.VAULT_TOKEN, // Token xác thực với Vault
});

// Hàm tải bí mật từ Vault
export async function loadVaultSecrets() {
  try {
    const { data } = await vaultClient.read('secret/data/xynapseai');
    const secrets = data.data;

    // Gán các bí mật vào process.env
    Object.keys(secrets).forEach((key) => {
      process.env[key] = secrets[key];
    });

    logger.info('Successfully loaded secrets from Vault');
  } catch (error) {
    logger.error(`Failed to load secrets from Vault: ${error.message}`, { stack: error.stack });
    throw error; // Ném lỗi để caller xử lý
  }
}