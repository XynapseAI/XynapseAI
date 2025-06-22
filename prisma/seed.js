// prisma/seed.js
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  await prisma.task.createMany({
    data: [
      {
        id: 'task1',
        description: 'Tweet about Web3 with #Web3Vibes',
        type: 'tweet',
        link: '#Web3Vibes',
        points: 100,
      },
      {
        id: 'task4',
        description: 'Follow @Ethereum on Twitter',
        type: 'follow',
        link: '@Ethereum',
        points: 50,
      },
      {
        id: 'task7',
        description: 'Follow @nextAI_labs on Twitter',
        type: 'follow',
        link: '@nextAI_labs',
        points: 50,
      },
      {
        id: 'task8',
        description: 'Interact with AI (0/5)',
        type: 'ai_interaction',
        points: 100, // Total points for completing 5 interactions
        isDaily: true,
        maxCompletions: 5,
      },
    ],
    skipDuplicates: true,
  });
  console.log('Seeded tasks');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });