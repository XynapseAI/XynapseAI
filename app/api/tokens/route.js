// app/api/tokens/route.js
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { logger } from '../../../utils/serverLogger'
import { query } from '../../../utils/postgres'

// Map chain IDs to chain names used in detail_platforms
const chainIdToName = {
  1: 'ethereum',
  56: 'bsc',
  10: 'optimism',
  130: 'unichain',
  137: 'polygon',
  5000: 'mantle',
  42161: 'arbitrum',
  43114: 'avalanche',
  59144: 'linea',
  534352: 'scroll',
  7777777: 'zora',
  solana: 'solana',
  tron: 'tron',
}

const getSchema = z
  .object({
    contractAddress: z.string().optional(),
    symbol: z.string().optional(),
    chain: z.string().nonempty('Chain is required'),
  })
  .refine((data) => data.contractAddress || data.symbol, {
    message: 'Either contractAddress or symbol must be provided',
  })

const postSchema = z.object({
  action: z.literal('update'),
  coingecko_id: z.string().nonempty('CoinGecko ID is required'),
  symbol: z.string().nonempty('Symbol is required'),
  name: z.string().nonempty('Name is required'),
  image: z.string().nonempty('Image URL is required'),
  chain: z.string().nonempty('Chain is required'),
  contractAddress: z.string().optional(),
})

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const contractAddress = searchParams.get('contractAddress')
  const symbol = searchParams.get('symbol')
  const chain = searchParams.get('chain')

  try {
    const parsedParams = getSchema.parse({ contractAddress, symbol, chain })

    // Convert chain ID to chain name
    const chainName = chainIdToName[chain] || chain
    logger.info(`Querying tokens for chain: ${chainName}`)

    let result

    if (parsedParams.contractAddress) {
      // Query by contractAddress
      result = await query(
        `SELECT image
         FROM tokens
         WHERE (detail_platforms->'${chainName}'->>'contract_address' = $1
                OR detail_platforms->''->>'contract_address' = $1)`,
        [parsedParams.contractAddress.toLowerCase()],
      )
    } else if (parsedParams.symbol) {
      // Query by symbol
      result = await query(
        `SELECT image
         FROM tokens
         WHERE symbol = $1
           AND (detail_platforms->'${chainName}'->>'contract_address' IS NOT NULL
                OR detail_platforms->''->>'contract_address' IS NOT NULL)`,
        [parsedParams.symbol.toLowerCase()],
      )
    }

    if (result.rows.length > 0 && result.rows[0].image) {
      logger.info(`Found image for ${contractAddress || symbol}: ${result.rows[0].image}`)
      return NextResponse.json({
        success: true,
        data: { image: result.rows[0].image },
      })
    }

    logger.warn(`No image found for ${contractAddress || symbol} on chain ${chainName}`)
    return NextResponse.json(
      {
        success: false,
        error: 'Token image not found in database',
      },
      { status: 404 },
    )
  } catch (err) {
    logger.error('Error fetching token image:', err.message)
    return NextResponse.json(
      {
        success: false,
        error: `Failed to fetch token image: ${err.message}`,
      },
      { status: 500 },
    )
  }
}

export async function POST(request) {
  try {
    const body = await request.json()
    const parsedBody = postSchema.parse(body)

    const { coingecko_id, symbol, name, image, chain, contractAddress } = parsedBody
    const chainName = chainIdToName[chain] || chain

    // Prepare detail_platforms JSON
    const detail_platforms = contractAddress
      ? {
          [chainName]: {
            contract_address: contractAddress.toLowerCase(),
            decimal_place: null,
            geckoterminal_url: `https://www.geckoterminal.com/${chainName}/tokens/${contractAddress.toLowerCase()}`,
          },
        }
      : { '': { contract_address: '', decimal_place: null } }

    // Insert or update token
    const result = await query(
      `INSERT INTO tokens (coingecko_id, symbol, name, image, detail_platforms)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (coingecko_id)
       DO UPDATE SET
         symbol = EXCLUDED.symbol,
         name = EXCLUDED.name,
         image = EXCLUDED.image,
         detail_platforms = EXCLUDED.detail_platforms,
         updated_at = CURRENT_TIMESTAMP
       RETURNING image`,
      [coingecko_id.toLowerCase(), symbol.toLowerCase(), name, image, detail_platforms],
    )

    logger.info(`Updated token ${symbol} for chain ${chainName} in database`)
    return NextResponse.json({
      success: true,
      data: { image: result.rows[0].image },
    })
  } catch (err) {
    logger.error('Error updating token:', err.message)
    return NextResponse.json(
      {
        success: false,
        error: `Failed to update token: ${err.message}`,
      },
      { status: 500 },
    )
  }
}
