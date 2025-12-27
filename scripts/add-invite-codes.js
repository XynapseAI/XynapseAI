import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

const prisma = new PrismaClient()

async function generateUniqueInviteCode() {
  let code
  let exists = true
  while (exists) {
    code = crypto.randomBytes(8).toString('hex') // 16 chars hex
    const user = await prisma.users.findUnique({ where: { invite_code: code } })
    exists = !!user
  }
  return code
}

async function addInviteCodes() {
  try {
    const usersWithoutCode = await prisma.users.findMany({
      where: { invite_code: null },
    })

    console.log(`Found ${usersWithoutCode.length} users without invite code.`)

    for (const user of usersWithoutCode) {
      const inviteCode = await generateUniqueInviteCode()
      await prisma.users.update({
        where: { id: user.id },
        data: { invite_code: inviteCode },
      })
      console.log(`Added invite code ${inviteCode} to user ${user.id}`)
    }

    console.log('Done adding invite codes.')
  } catch (error) {
    console.error('Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

addInviteCodes()
