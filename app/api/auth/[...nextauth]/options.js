import { randomBytes } from 'crypto'
import GoogleProvider from '@auth/core/providers/google'
import EmailProvider from '@auth/core/providers/email'
import CredentialsProvider from '@auth/core/providers/credentials'
import { SiweMessage } from 'siwe'
import { createTransport } from 'nodemailer'
import { v4 as uuidv4 } from 'uuid'
import { query } from '@/utils/postgres'
import { logger } from '@/utils/serverLogger'
import crypto from 'crypto'
import util from 'util'
import { NeynarAPIClient, Configuration } from '@neynar/nodejs-sdk'
import { createClient as createQuickAuthClient } from '@farcaster/quick-auth'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { createPublicClient, http, hexToBytes, hashMessage } from 'viem'
import * as chains from 'viem/chains'

const scrypt = util.promisify(crypto.scrypt)

async function hashApiKey(apiKey) {
  const salt = crypto.randomBytes(16).toString('hex')
  const derived = await scrypt(apiKey, salt, 64)
  return {
    api_key_hash: derived.toString('hex'),
    api_key_salt: salt,
  }
}

// NEW: Verify quickauth JWT token
async function verifyFarcasterJwt(token, req) {
  try {
    const quickAuthClient = createQuickAuthClient()
    let domain = process.env.NEXTAUTH_URL
      ? new URL(process.env.NEXTAUTH_URL).hostname
      : req?.headers?.host || 'localhost:3000'
    const payload = await quickAuthClient.verifyJwt({ token, domain })
    if (!payload?.sub) throw new Error('Invalid JWT: No FID')
    const fid = parseInt(payload.sub, 10)
    logger.info('QuickAuth verified', { fid })
    return fid
  } catch (error) {
    logger.error('QuickAuth verify failed', { error: error.message })
    throw error
  }
}

async function verifyWorldSiwe(messageStr, signature) {
  try {
    const message = new SiweMessage(messageStr)
    logger.info('World SIWE input details', {
      chainId: message.chainId,
      address: message.address?.toLowerCase(),
      signaturePreview: signature.substring(0, 10) + '...' + signature.slice(-10),
      messagePreview: messageStr.substring(0, 50) + '...',
    })

    //standard ECDSA verify
    let valid = false
    try {
      valid = await message.verify({ signature })
      logger.info('Standard SIWE verify result', { valid })
    } catch (standardErr) {
      logger.warn('Standard SIWE verify failed (expected for smart wallet)', {
        error: standardErr.message,
      })
    }

    if (valid) {
      const allowedChains = [10, 8453, 480] // Optimism, Base, World
      if (!allowedChains.includes(Number(message.chainId))) {
        throw new Error(`Invalid chainId: expected ${allowedChains.join('/')}`)
      }
      const address = message.address.toLowerCase()
      logger.info('World SIWE verified (ECDSA)', { address, chainId: message.chainId })
      return address
    }

    // Fallback EIP-1271 smart wallet
    logger.info('Fallback to EIP-1271 verification...')
    const chainId = Number(message.chainId)
    let chainConfig

    if (chainId === 10) {
      chainConfig = chains.optimism // RPC: https://mainnet.optimism.io
    } else if (chainId === 8453) {
      chainConfig = chains.base // RPC: https://mainnet.base.org
    } else if (chainId === 480) {
      chainConfig = {
        id: 480,
        name: 'World Chain',
        nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
        rpcUrls: {
          default: { http: ['https://worldchain-mainnet.g.alchemy.com/public'] },
        },
        blockExplorers: { default: { name: 'WorldScan', url: 'https://worldscan.org' } },
      }
    } else {
      throw new Error(`Unsupported chainId: ${chainId}. Expected 10/8453/480.`)
    }

    const publicClient = createPublicClient({
      chain: chainConfig,
      transport: http(),
    })

    const address = message.address.toLowerCase()
    const preparedMessage = message.prepareMessage()
    const messageHash = hashMessage(preparedMessage) // '0x...' hex

    if (!messageHash.startsWith('0x') || !signature.startsWith('0x')) {
      throw new Error(
        `Invalid hex format: messageHash=${messageHash.substring(0, 10)}..., signature=${signature.substring(0, 10)}...`,
      )
    }

    const isValidSig = await publicClient.readContract({
      address: address,
      abi: [
        {
          name: 'isValidSignature',
          type: 'function',
          inputs: [
            { type: 'bytes32', name: '_hash' },
            { type: 'bytes', name: '_signature' },
          ],
          outputs: [{ type: 'bytes4' }],
          stateMutability: 'view',
        },
      ],
      functionName: 'isValidSignature',
      args: [messageHash, signature],
    })

    const MAGIC_VALUE = '0x1626ba7e'
    if (isValidSig.toLowerCase() !== MAGIC_VALUE) {
      throw new Error(`Invalid EIP-1271 sig. Got: ${isValidSig}, expected: ${MAGIC_VALUE}`)
    }

    logger.info('World SIWE verified (EIP-1271)', { address, chainId })
    return address
  } catch (error) {
    logger.error('World SIWE verify failed (detailed)', {
      error: error.message,
      stack: error.stack,
      chainId: new SiweMessage(messageStr).chainId,
      address: new SiweMessage(messageStr).address,
    })
    throw error
  }
}

// ================== Email Transporter ==================
const transporter = createTransport({
  host: process.env.EMAIL_SERVER_HOST,
  port: process.env.EMAIL_SERVER_PORT,
  auth: {
    user: process.env.EMAIL_SERVER_USER,
    pass: process.env.EMAIL_SERVER_PASSWORD,
  },
})

// ================== Custom Adapter ==================
const customAdapter = {
  async getUserByEmail(email) {
    logger.info('Fetching user by email', { email })
    const { rows } = await query(
      `SELECT id,email,google_id,google_name,email_verified,profile_picture,
              connected,last_connected,points,tweet_points,ai_points,task_points,
              is_creator,is_ai_rank,tier,is_plus,is_premium,api_key_hash,api_key_salt,created_at
       FROM users WHERE email=$1`,
      [email],
    )
    return rows[0] ? { ...rows[0], id: rows[0].id.toString() } : null
  },
  async getUserByAccount({ provider, providerAccountId }) {
    logger.info('Fetching user by account', { provider, providerAccountId })
    const { rows } = await query(
      `SELECT u.* FROM users u
       JOIN accounts a ON u.id=a.userId
       WHERE a.provider=$1 AND a.providerAccountId=$2`,
      [provider, providerAccountId],
    )
    return rows[0] ? { ...rows[0], id: rows[0].id.toString() } : null
  },
  async getUserByFid(fid) {
    const fidNum = Number(fid)
    const fidStr = fid.toString()
    const { rows } = await query(`SELECT * FROM users WHERE farcaster_fid = $1 OR id = $2`, [
      fidNum,
      fidStr,
    ])
    return rows[0] ? { ...rows[0], id: rows[0].id.toString() } : null
  },
  // NEW: getUserByWallet
  async getUserByWallet(walletAddress) {
    const { rows } = await query(`SELECT * FROM users WHERE wallet_address = $1`, [
      walletAddress.toLowerCase(),
    ])
    return rows[0] ? { ...rows[0], id: rows[0].id.toString() } : null
  },
  async createUser(data) {
    const id = data.google_id || data.id || uuidv4()
    logger.info('Creating user', { id, email: data.email })

    // Ensure email is not null
    if (!data.email) {
      logger.error('Cannot create user without email', { id })
      throw new Error('Email is required for user creation')
    }

    const userId = typeof id === 'number' ? id.toString() : id
    const plainApiKey = randomBytes(32).toString('hex')
    const { api_key_hash, api_key_salt } = await hashApiKey(plainApiKey)

    const { rows } = await query(
      `INSERT INTO users (
        id,email,google_id,google_name,email_verified,profile_picture,
        connected,last_connected,points,tweet_points,ai_points,task_points,
        is_creator,is_ai_rank,tier,is_plus,is_premium,api_key_hash,api_key_salt,created_at,
        wallet_address
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      ON CONFLICT (google_id) DO UPDATE SET
        email=EXCLUDED.email,google_name=EXCLUDED.google_name,email_verified=EXCLUDED.email_verified,
        profile_picture=COALESCE(users.profile_picture, EXCLUDED.profile_picture),connected=EXCLUDED.connected,
        last_connected=EXCLUDED.last_connected,updated_at=CURRENT_TIMESTAMP, api_key_hash=EXCLUDED.api_key_hash, api_key_salt=EXCLUDED.api_key_salt,
        wallet_address=COALESCE(users.wallet_address, EXCLUDED.wallet_address)
      RETURNING *`,
      [
        userId,
        data.email,
        data.google_id || null,
        data.google_name || null,
        data.email_verified || false,
        data.profile_picture || null,
        true,
        new Date(),
        0,
        0,
        0,
        0,
        false,
        false,
        'Basic',
        false,
        false,
        api_key_hash,
        api_key_salt,
        new Date(),
        data.wallet_address || null,
      ],
    )
    logger.info('User created', { id: userId, email: data.email, rowCount: rows.length })
    return { ...rows[0], id: rows[0].id.toString() }
  },
  async updateUser(data) {
    logger.info('Updating user', { id: data.id, email: data.email })
    // Use COALESCE to avoid setting null values for required/important fields
    const { rows } = await query(
      `UPDATE users SET 
        email = COALESCE($2, email),
        google_id = COALESCE($3, google_id),
        google_name = COALESCE($4, google_name),
        email_verified = COALESCE($5, email_verified),
        profile_picture = COALESCE($6, profile_picture),
        connected = $7,
        last_connected = $8,
        updated_at = $9,
        wallet_address = COALESCE($10, wallet_address)
       WHERE id=$1 RETURNING *`,
      [
        data.id,
        data.email || null,
        data.google_id || null,
        data.google_name || null,
        data.email_verified !== undefined ? data.email_verified : null,
        data.profile_picture || null,
        data.connected !== undefined ? data.connected : true,
        data.last_connected || new Date(),
        new Date(),
        data.wallet_address || null,
      ],
    )
    logger.info('User updated', { id: data.id, rowCount: rows.length })
    return { ...rows[0], id: rows[0].id.toString() }
  },

  async updateFarcasterUser(id, fid) {
    const fidNum = Number(fid)
    await query(
      `UPDATE users SET farcaster_fid = $1, last_connected = $2, connected = $3, updated_at = $4 WHERE id = $5`,
      [fidNum, new Date(), true, new Date(), id],
    )
    logger.info('Farcaster user updated', { id, fid: fidNum })
  },
  // NEW: updateWorldUser
  async updateWorldUser(id, walletAddress) {
    await query(
      `UPDATE users SET wallet_address = $1, last_connected = $2, connected = $3, updated_at = $4 WHERE id = $5`,
      [walletAddress.toLowerCase(), new Date(), true, new Date(), id],
    )
    logger.info('World user updated', { id, walletAddress })
  },
  async createVerificationToken({ identifier, expires, token }) {
    logger.info('Creating verification token', { identifier })
    // Ensure identifier (email) is not null
    if (!identifier) {
      logger.error('Cannot create verification token without identifier')
      throw new Error('Identifier is required for verification token')
    }
    const { rows } = await query(
      `INSERT INTO verification_tokens (identifier,token,expires)
       VALUES ($1,$2,$3) RETURNING *`,
      [identifier, token, expires],
    )
    return rows[0]
  },
  async useVerificationToken({ identifier, token }) {
    logger.info('Using verification token', { identifier })
    // Ensure identifier is not null
    if (!identifier) {
      logger.error('Cannot use verification token without identifier')
      return null
    }
    const { rows } = await query(
      `DELETE FROM verification_tokens WHERE identifier=$1 AND token=$2 RETURNING *`,
      [identifier, token],
    )
    return rows[0] || null
  },
}

const isProd = process.env.NODE_ENV === 'production'
const cookieDomain = isProd ? '.xynapseai.net' : undefined // Dev: undefined (default localhost), Prod: share subdomain

// ================== Auth Options ==================
export const authOptions = {
  adapter: customAdapter,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          prompt: 'consent',
          access_type: 'offline',
          response_type: 'code',
        },
      },
    }),
    EmailProvider({
      server: {
        host: process.env.EMAIL_SERVER_HOST,
        port: process.env.EMAIL_SERVER_PORT,
        auth: {
          user: process.env.EMAIL_SERVER_USER,
          pass: process.env.EMAIL_SERVER_PASSWORD,
        },
      },
      from: process.env.EMAIL_FROM,
      sendVerificationRequest: async ({ identifier, url, provider }) => {
        logger.info('Sending email verification', { identifier, url })
        // Ensure identifier is valid email
        if (!identifier || !identifier.includes('@')) {
          logger.error('Invalid email identifier for verification', { identifier })
          throw new Error('Invalid email address')
        }
        await transporter.sendMail({
          to: identifier,
          from: provider.from,
          subject: 'Welcome to XynapseAI! Confirm Login',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h1 style="color: #4285f4; text-align: center;">Welcome to XynapseAI !</h1>
              <p>Hello,</p>
              <p>You have requested to log in to your Xynapse account using this email address.</p>
              <p>To complete your login, click the button below:</p>
              <div style="text-align: center; margin: 20px 0;">
                <a href="${url}" style="background: #4285f4; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Login now</a>
              </p>
              <p>If you do not require this login, please ignore this email.</p>
              <p style="font-size: 12px; color: #666;">This link will expire after 24 hours.</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
              <p style="font-size: 12px; color: #666; text-align: center;">Thank you!</p>
            </div>
          `,
        })
      },
    }),
    CredentialsProvider({
      id: 'farcaster',
      name: 'Sign in with Farcaster',
      credentials: {
        message: { label: 'SIWE Message', type: 'text' },
        signature: { label: 'Signature', type: 'text' },
        token: { label: 'QuickAuth Token', type: 'text' }, // NEW: quickauth
      },
      async authorize(credentials, req) {
        try {
          let fid
          // NEW: Handle quickauth token (cho miniapp)
          if (credentials.token) {
            fid = await verifyFarcasterJwt(credentials.token, req)
          } else if (credentials.message && credentials.signature) {
            // Old SIWE flow
            const message = new SiweMessage(credentials.message)
            const fields = message.prepareMessage()

            if (fields !== credentials.message) {
              logger.error('Invalid Farcaster message fields')
              return null
            }

            const valid = await message.verify({ signature: credentials.signature })
            if (!valid) {
              logger.error('Invalid Farcaster signature')
              return null
            }

            // FIXED: Validate FIP-11 fields (robust chainId comparison)
            if (message.statement !== 'Farcaster Auth') {
              logger.error("Invalid Farcaster statement: expected 'Farcaster Auth'", {
                statement: message.statement,
              })
              return null
            }

            if (Number(message.chainId) !== 10) {
              logger.error('Invalid Farcaster chainId: expected 10 (Optimism)', {
                chainId: message.chainId,
                type: typeof message.chainId,
                parsed: Number(message.chainId),
              })
              return null
            }

            // NEW: Light domain check to prevent origin mismatch (fix PC config error)
            const expectedDomain = process.env.NEXTAUTH_URL
              ? new URL(process.env.NEXTAUTH_URL).hostname
              : req?.headers?.host || 'localhost:3000'
            if (message.domain !== expectedDomain) {
              logger.error('Domain mismatch in Farcaster SIWE', {
                expected: expectedDomain,
                got: message.domain,
              })
              return null
            }

            const resources = message.resources
            if (!resources || !Array.isArray(resources) || resources.length === 0) {
              logger.error('No resources in Farcaster message')
              return null
            }

            // FIXED: Match both spec (fids/) and impl (fid/) formats
            const fidResource = resources.find(
              (r) =>
                typeof r === 'string' &&
                (r.startsWith('farcaster://fids/') || r.startsWith('farcaster://fid/')),
            )
            if (!fidResource) {
              logger.error('No FID resource in Farcaster message', { resources })
              return null
            }

            // FIXED: Regex for both (?:fids|fid)
            const fidMatch = fidResource.match(/farcaster:\/\/(?:fids|fid)\/(\d+)/)
            if (!fidMatch) {
              logger.error('Invalid FID resource format', { fidResource })
              return null
            }
            fid = fidMatch[1]
          } else {
            throw new Error('Missing credentials for Farcaster auth')
          }

          const fidNum = Number(fid)
          const fidStr = fid.toString()
          const config = new Configuration({
            apiKey: process.env.NEYNAR_API_KEY,
            baseOptions: {
              headers: {
                'x-neynar-experimental': true,
              },
            },
          })
          const client = new NeynarAPIClient(config)

          let userInfo = { pfp_url: null, display_name: null, username: null }
          try {
            const res = await client.fetchBulkUsers({ fids: [fidNum] })
            const fetchedUser = res.users[0]
            if (fetchedUser) {
              userInfo = {
                pfp_url: fetchedUser.pfp_url || null,
                display_name: fetchedUser.display_name || null,
                username: fetchedUser.username || null,
              }
              logger.info('Neynar user fetched successfully', {
                fid: fidNum,
                pfp_url: userInfo.pfp_url ? 'present' : 'missing',
              })
            } else {
              logger.warn('No user found in Neynar response', { fid: fidNum })
            }
          } catch (neynarErr) {
            logger.warn('Neynar fetch failed (proceeding without profile info)', {
              fid: fidNum,
              error: neynarErr.message,
            })
          }

          const fakeEmail = `${fid}@farcaster.local`

          const existingUser = await customAdapter.getUserByFid(fidStr)

          if (existingUser) {
            await customAdapter.updateFarcasterUser(existingUser.id, fidNum) // NEW: Update FID
            return existingUser
          }

          const newUser = await customAdapter.createUser({
            id: fidStr, // FIXED: String cho text column
            email: fakeEmail,
            profile_picture: userInfo.pfp_url || null,
            google_name: userInfo.display_name || userInfo.username || null,
            email_verified: true,
          })

          // Link account
          await query(
            `INSERT INTO accounts (userId, type, provider, providerAccountId)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (provider, providerAccountId) DO NOTHING`,
            [newUser.id, 'credentials', 'farcaster', fidStr], // FIXED: providerAccountId string
          )

          // NEW: Update FID column (migration needed: ALTER TABLE users ADD COLUMN farcaster_fid BIGINT;)
          await query(`UPDATE users SET farcaster_fid = $1 WHERE id = $2`, [fidNum, newUser.id])

          logger.info('Farcaster user created/authorized', { fid: fidNum })
          return newUser
        } catch (err) {
          logger.error('Farcaster authorize error', { error: err.message })
          return null
        }
      },
    }),
    // NEW: CredentialsProvider World (SIWE via Wallet Auth)
    CredentialsProvider({
      id: 'world',
      name: 'Sign in with World',
      credentials: {
        message: { label: 'SIWE Message', type: 'text' },
        signature: { label: 'Signature', type: 'text' },
      },
      async authorize(credentials) {
        try {
          if (!credentials.message || !credentials.signature) {
            throw new Error('Missing credentials for World auth')
          }

          // Verify SIWE
          const address = await verifyWorldSiwe(credentials.message, credentials.signature)

          const fakeEmail = `${address}@world.local`
          const existingUser = await customAdapter.getUserByWallet(address)

          if (existingUser) {
            await customAdapter.updateWorldUser(existingUser.id, address)
            return existingUser
          }

          const newUser = await customAdapter.createUser({
            id: uuidv4(), // UUID
            email: fakeEmail,
            profile_picture: null,
            google_name: address.slice(0, 6) + '...' + address.slice(-4),
            email_verified: true,
            wallet_address: address,
          })

          await query(
            `INSERT INTO accounts (userId, type, provider, providerAccountId)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (provider, providerAccountId) DO NOTHING`,
            [newUser.id, 'credentials', 'world', address],
          )

          await query(`UPDATE users SET wallet_address = $1 WHERE id = $2`, [address, newUser.id])

          logger.info('World user created/authorized', { address })
          return newUser
        } catch (err) {
          logger.error('World authorize error', { error: err.message })
          return null
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      try {
        logger.info('Sign-in attempt', {
          provider: account.provider,
          providerId: account.providerId || account.id,
          email: user.email,
        })
        let email = user.email || ''
        let googleId = null,
          googleName = null,
          profilePic = '',
          verified = false,
          userId = null

        if (!email) {
          logger.error('Sign-in failed: No email provided', { provider: account.provider })
          return false
        }

        if (account.provider === 'google') {
          email = profile.email || user.email || ''
          if (!email) {
            logger.error('Google sign-in failed: No email in profile', {
              providerAccountId: profile.sub,
            })
            return false
          }
          profilePic = profile.picture || ''
          googleId = profile.sub
          googleName = profile.name
          verified = profile.email_verified || false
          userId = googleId

          const existingUser = await customAdapter.getUserByEmail(email)
          if (existingUser) {
            if (existingUser.google_id) {
              userId = existingUser.id
            } else {
              userId = existingUser.id
              await query(
                `UPDATE users SET 
                google_id = $1, google_name = $2, profile_picture = COALESCE($3, profile_picture),
                email_verified = $4, last_connected = $5, connected = $6, updated_at = $7
              WHERE id = $8`,
                [googleId, googleName, profilePic, verified, new Date(), true, new Date(), userId],
              )
              logger.info('Merged Google to existing email user', { userId, email })

              // Link account
              await query(
                `INSERT INTO accounts (userId, type, provider, providerAccountId, access_token, expires_at, token_type, scope, id_token)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (provider, providerAccountId) DO NOTHING`,
                [
                  userId,
                  account.type,
                  account.provider,
                  account.providerAccountId,
                  account.access_token,
                  account.expires_at ? account.expires_at : null,
                  account.token_type,
                  account.scope,
                  account.id_token,
                ],
              )
            }
          } else {
            const plainApiKey = randomBytes(32).toString('hex')
            const { api_key_hash, api_key_salt } = await hashApiKey(plainApiKey)

            const result = await query(
              `INSERT INTO users (
              id, email, google_id, google_name, email_verified, profile_picture,
              connected, last_connected, points, tweet_points, ai_points, task_points,
              is_creator, is_ai_rank, tier, is_plus, is_premium, api_key_hash, api_key_salt, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
            ON CONFLICT (google_id) DO UPDATE SET
              email=EXCLUDED.email, google_name=EXCLUDED.google_name, email_verified=EXCLUDED.email_verified, 
              profile_picture=COALESCE(users.profile_picture, EXCLUDED.profile_picture), connected=EXCLUDED.connected,
              last_connected=EXCLUDED.last_connected, updated_at=CURRENT_TIMESTAMP, api_key_hash=EXCLUDED.api_key_hash, api_key_salt=EXCLUDED.api_key_salt`,
              [
                userId,
                email,
                googleId,
                googleName,
                verified,
                profilePic,
                true,
                new Date(),
                0,
                0,
                0,
                0,
                false,
                false,
                'Basic',
                false,
                false,
                api_key_hash,
                api_key_salt,
                new Date(),
              ],
            )
            await query(
              `INSERT INTO accounts (userId, type, provider, providerAccountId, access_token, expires_at, token_type, scope, id_token)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (provider, providerAccountId) DO UPDATE SET
               access_token = $5, expires_at = $6, token_type = $7, scope = $8, id_token = $9`,
              [
                userId,
                account.type,
                account.provider,
                account.providerAccountId,
                account.access_token,
                account.expires_at ? account.expires_at : null,
                account.token_type,
                account.scope,
                account.id_token,
              ],
            )
          }
          user.id = userId.toString()

          logger.info('Google user merged/created', { userId, email })
          return true
        }
        // FIXED: account.providerId -> account.provider (Auth.js v5 set provider = id credentials)
        else if (account.provider === 'farcaster') {
          user.id = account.providerAccountId.toString()
          logger.info('Farcaster sign-in successful (DB handled in authorize)', { fid: user.id })
          return true // No redundant updates needed
        } else if (account.provider === 'world') {
          user.id = account.providerAccountId // address
          logger.info('World sign-in successful', { address: user.id })
          return true
        } else if (account.provider === 'email') {
          email = user.email || account.user?.email || ''
          if (!email) {
            logger.error('Email sign-in failed: No email provided', { token: account.token })
            return false
          }
          verified = true

          // Check existing user by email
          const existingUser = await customAdapter.getUserByEmail(email)
          if (existingUser) {
            userId = existingUser.id
            // Update existing user
            await query(
              `UPDATE users SET 
              last_connected = $1, connected = $2, email_verified = $3, updated_at = $4
            WHERE id = $5`,
              [new Date(), true, verified, new Date(), userId],
            )
            logger.info('Existing email user updated', { userId, email })
            const plainApiKey = randomBytes(32).toString('hex')
            const { api_key_hash, api_key_salt } = await hashApiKey(plainApiKey)
            await query(`UPDATE users SET api_key_hash = $1, api_key_salt = $2 WHERE id = $3`, [
              api_key_hash,
              api_key_salt,
              userId,
            ])

            logger.info('Sign-in successful for existing user', { userId, email })
            // FIXED: Set user.id = DB userId
            user.id = userId.toString()
            return true
          } else {
            userId = uuidv4()
            const plainApiKey = randomBytes(32).toString('hex')
            const { api_key_hash, api_key_salt } = await hashApiKey(plainApiKey)

            const result = await query(
              `INSERT INTO users (
              id, email, google_id, google_name, email_verified, profile_picture,
              connected, last_connected, points, tweet_points, ai_points, task_points,
              is_creator, is_ai_rank, tier, is_plus, is_premium, api_key_hash, api_key_salt, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
              [
                userId,
                email,
                null,
                null,
                verified,
                null,
                true,
                new Date(),
                0,
                0,
                0,
                0,
                false,
                false,
                'Basic',
                false,
                false,
                api_key_hash,
                api_key_salt,
                new Date(),
              ],
            )

            logger.info('New email user created', { userId, email, rowCount: result.rowCount })
            logger.info('Sign-in successful', { userId, email })
            // FIXED: Set user.id = DB userId
            user.id = userId.toString()
            return true
          }
        }

        logger.error('Sign-in failed: Unsupported provider', {
          provider: account.provider,
          providerId: account.providerId || account.id,
        }) // FIX: Log account.id
        return false
      } catch (err) {
        logger.error('signIn error', { error: err.message, stack: err.stack })
        return false
      }
    },
    async jwt({ token, user, account, profile }) {
      logger.info('JWT callback', { tokenId: token.id, email: token.email })
      if (account && user) {
        token.id =
          user.id ||
          (account.provider === 'google'
            ? account.providerAccountId
            : token.sub || uuidv4()
          ).toString()
        token.accessToken = account.access_token || randomBytes(32).toString('hex')
        token.expiresAt = Date.now() + 2 * 60 * 60 * 1000 // 2 hours
        token.email = profile?.email || token.email || account.user?.email || user.email
        token.googleName = profile?.name || user.googleName || ''
        token.csrfToken = token.csrfToken || randomBytes(32).toString('hex')
      }
      if (Date.now() > token.expiresAt) {
        logger.info('Token expired, refreshing', { tokenId: token.id })
        token.accessToken = randomBytes(32).toString('hex')
        token.expiresAt = Date.now() + 2 * 60 * 60 * 1000
        token.csrfToken = randomBytes(32).toString('hex')
      }
      logger.info('JWT token', { token: JSON.stringify(token) })
      return token
    },
    async session({ session, token }) {
      logger.info('Session callback', { userId: token.id })
      if (!token.id) {
        logger.error('Token missing id', { token: JSON.stringify(token) })
        throw new Error('Invalid token: missing id')
      }
      session.user = session.user || {}
      session.user.id = token.id.toString()
      session.user.email = token.email
      session.user.googleName = token.googleName
      session.user.isPremium = token.isPremium || false
      session.csrfToken = token.csrfToken
      logger.info('Session created', { session: JSON.stringify(session) })
      return session
    },
    // FIXED: Use standard NextAuth redirect callback (remove custom cleanUrl to avoid loop/config error)
    async redirect({ url, baseUrl }) {
      // Allows relative callback URLs
      if (url.startsWith('/')) return `${baseUrl}${url}`
      // Allows callback URLs on the same origin
      else if (new URL(url).origin === baseUrl) return url
      return baseUrl
    },
  },
  ...(isProd && {
    cookies: {
      sessionToken: {
        name: 'next-auth.session-token',
        options: {
          httpOnly: false, // FIX: false Mini App compatibility
          sameSite: 'none', // CHANGED: 'none' to allow cross-site (iframe) requests
          path: '/',
          secure: true,
          domain: cookieDomain,
        },
      },
      callbackUrl: {
        name: 'next-auth.callback-url',
        options: {
          httpOnly: false,
          sameSite: 'none', // CHANGED: 'none'
          path: '/',
          secure: true,
          domain: cookieDomain,
        },
      },
      csrfToken: {
        name: 'next-auth.csrf-token',
        options: {
          httpOnly: false, // FIX: false webview persist cookie
          sameSite: 'none', // CHANGED: 'none'
          path: '/',
          secure: true,
          domain: cookieDomain,
        },
      },
    },
  }),
  secret: process.env.AUTH_SECRET,
  session: { strategy: 'jwt', maxAge: 2 * 60 * 60 }, // 2 hours
  pages: {
    signIn: '/dashboard',
    error: '/auth/error',
  },
}

export default authOptions
