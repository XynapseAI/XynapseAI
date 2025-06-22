// scripts/addTask.js
const { db } = require('../utils/firebaseAdmin');

async function addTask(taskData) {
  try {
    const taskRef = db.collection('tasks').doc();
    await taskRef.set({
      description: taskData.description,
      points: taskData.points,
      isDaily: taskData.isDaily || false,
      maxCompletions: taskData.maxCompletions || 1,
      type: taskData.type,
      link: taskData.link || '',
      createdAt: new Date().toISOString(),
    });
    console.log(`Task added successfully with ID: ${taskRef.id}`);
  } catch (error) {
    console.error('Error adding task:', error);
  }
}

// Example tasks
const tasks = [
  {
    description: 'Follow @example on X (0/1)',
    points: 100,
    isDaily: true,
    maxCompletions: 1,
    type: 'follow',
    link: '@example',
  },
  {
    description: 'Like post https://x.com/status/123456789 (0/1)',
    points: 50,
    isDaily: true,
    maxCompletions: 1,
    type: 'like',
    link: 'https://x.com/status/123456789',
  },
  {
    description: 'Join Discord server (0/1)',
    points: 200,
    isDaily: true,
    maxCompletions: 1,
    type: 'join',
    link: 'https://discord.gg/abc123',
  },
];

async function populateTasks() {
  const batch = db.batch();
  tasks.forEach((task) => {
    const taskRef = db.collection('tasks').doc();
    batch.set(taskRef, task);
  });
  await batch.commit();
  console.log('Tasks populated successfully');
}

populateTasks().catch(console.error);