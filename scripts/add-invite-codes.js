// scripts\add-invite-codes.js
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

const prisma = new PrismaClient()

async function generateUniqueInviteCode() {
  let code
  let exists = true
  while (exists) {
    // Tạo 16 ký tự hex và chuyển sang chữ hoa
    code = crypto.randomBytes(8).toString('hex').toUpperCase()
    const user = await prisma.users.findUnique({ where: { invite_code: code } })
    exists = !!user
  }
  return code
}

async function regenerateAllInviteCodes() {
  try {
    // Lấy TẤT CẢ users (không có điều kiện where)
    const allUsers = await prisma.users.findMany({})

    console.log(`Found ${allUsers.length} users in total. Regenerating invite codes for all...`)

    for (const user of allUsers) {
      const newInviteCode = await generateUniqueInviteCode()
      await prisma.users.update({
        where: { id: user.id },
        data: { invite_code: newInviteCode },
      })
      console.log(`Regenerated invite code ${newInviteCode} for user ${user.id} (old code was: ${user.invite_code || 'none'})`)
    }

    console.log('Done regenerating invite codes for all users.')
  } catch (error) {
    console.error('Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

regenerateAllInviteCodes()