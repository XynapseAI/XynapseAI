// scripts/populateFirestore.js
const { db, admin } = require('../utils/firebaseAdmin');

async function populateSampleData() {
  const batch = db.batch();

  // User data
  batch.set(db.collection('users').doc('1927681051373305858'), {
    twitterHandle: 'nextAI_labs',
    twitterPFP: 'https://pbs.twimg.com/profile_images/1931609377846513664/fk2Jh9Qd_normal.jpg',
    twitterConnected: true,
    points: 10,
    tweetPoints: 0,
    aiPoints: 10,
    taskPoints: 0,
    isCreator: false,
    isAiRank: false,
    tier: 'Basic',
    isPlus: false,
    lastConnected: new Date(),
  });

  // Task data
  batch.set(db.collection('tasks').doc('task8'), {
    description: 'Daily AI chat interaction',
    type: 'ai_interaction',
    points: 10,
    isDaily: true,
    maxCompletions: 5,
  });

  // Daily AI interaction data
  batch.set(db.collection('dailyAIInteractions').doc('1927681051373305858_task8_2025-06-21'), {
    userId: '1927681051373305858',
    taskId: 'task8',
    count: 1,
    timestamp: admin.firestore.Timestamp.fromDate(new Date('2025-06-21')),
    points: 10,
    description: 'Daily AI chat interaction',
  });

  await batch.commit();
  console.log('Sample data populated');
}

populateSampleData().catch(console.error);