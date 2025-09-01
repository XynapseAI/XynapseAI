import crypto from 'crypto';
import { logger } from './serverLogger';

const algorithm = 'aes-256-gcm';
const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
const ivLength = 16;
const authTagLength = 16;

export function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(ivLength);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decrypt(encryptedText) {
  if (!encryptedText) return null;
  try {
    // Kiểm tra định dạng dữ liệu mã hóa
    if (typeof encryptedText !== 'string' || !encryptedText.includes(':')) {
      logger.warn('Invalid encrypted text format', { encryptedText });
      return null; // Trả về null thay vì ném lỗi
    }

    const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
    if (!ivHex || !authTagHex || !encrypted) {
      logger.warn('Incomplete encrypted text components', { encryptedText });
      return null;
    }

    // Kiểm tra độ dài của iv và authTag
    if (ivHex.length !== ivLength * 2 || authTagHex.length !== authTagLength * 2) {
      logger.warn('Invalid iv or authTag length', { ivLength: ivHex.length, authTagLength: authTagHex.length });
      return null;
    }

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    logger.error('Decryption failed', { err: err.message, encryptedText });
    return null; // Trả về null thay vì ném lỗi
  }
}