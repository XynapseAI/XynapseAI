// scripts/populateTweetAnalyses.js
const { db, admin } = require('../utils/firebaseAdmin');
async function populate() {
  const batch = db.batch();
  batch.set(db.collection('tweetAnalyses').doc(), {
    text: 'bitcoin bullish',
    createdAt: admin.firestore.Timestamp.fromDate(new Date()),
  });
  batch.set(db.collection('tweetAnalyses').doc(), {
    text: 'bitcoin bearish',
    createdAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 86400000)), // 1 day ago
  });
  await batch.commit();
  console.log('tweetAnalyses populated');
}
populate().catch(console.error);