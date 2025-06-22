// utils/firebaseAdmin.js
const admin = require('firebase-admin');

const serviceAccount = require('../firebase/next-62115-firebase-adminsdk-fbsvc-831aef7d77.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`,
  });
}

const db = admin.firestore();
module.exports = { admin, db };