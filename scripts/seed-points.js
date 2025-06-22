// scripts/seed-points.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    include: { tweetAnalyses: true, taskCompletions: { include: { task: true } } },
  });

  for (const user of users) {
    const tweetPoints = user.tweetAnalyses.reduce((sum, analysis) => sum + analysis.points, 0);
    const taskPoints = user.taskCompletions.reduce((sum, completion) => sum + completion.task.points, 0);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        tweetPoints,
        taskPoints,
        points: tweetPoints + user.aiPoints + taskPoints,
      },
    });
  }
  console.log('Points updated for all users.');
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());