// scripts/populateTasks.js
const { db, admin } = require('../utils/firebaseAdmin');
async function populate() {
  const batch = db.batch();
  batch.set(db.collection('tasks').doc('task8'), {
    id: 'task8',
    isDaily: true,
    maxCompletions: 5,
    points: 10,
  });
  batch.set(db.collection('tasks').doc('task9'), {
    id: 'task9',
    isDaily: true,
    maxCompletions: 5,
    points: 10,
  });
  await batch.commit();
  console.log('Tasks populated');
}
populate().catch(console.error);