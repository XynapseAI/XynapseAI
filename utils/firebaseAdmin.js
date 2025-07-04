import admin from 'firebase-admin';
import { getSecrets } from '../lib/vault'; // Thêm import

async function initializeFirebaseAdmin() {
  const secrets = await getSecrets(); // Lấy bí mật từ Vault
  const FIREBASE_CLIENT_EMAIL = secrets.FIREBASE_CLIENT_EMAIL;
  const FIREBASE_PRIVATE_KEY = secrets.FIREBASE_PRIVATE_KEY;

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }
  return admin;
}

const firebaseAdmin = await initializeFirebaseAdmin();
const db = firebaseAdmin.firestore();

export { db, firebaseAdmin as admin };