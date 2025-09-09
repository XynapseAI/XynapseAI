// app/api/tokens/route.js
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { query } from '../../../utils/postgres';

// Map chain IDs to chain names used in detail_platforms
const chainIdToName = {
  '1': 'ethereum',
  '56': 'bsc',
  'solana': 'solana',
  'tron': 'tron',
};

const bodySchema = z.object({
  contractAddress: z.string().optional(),
  symbol: z.string().optional(),
  chain: z.string().nonempty('Chain is required'),
}).refine((data) => data.contractAddress || data.symbol, {
  message: 'Either contractAddress or symbol must be provided',
});

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const contractAddress = searchParams.get('contractAddress');
  const symbol = searchParams.get('symbol');
  const chain = searchParams.get('chain');

  try {
    const parsedParams = bodySchema.parse({ contractAddress, symbol, chain });

    // Convert chain ID to chain name
    const chainName = chainIdToName[chain] || chain;
    logger.info(`Querying tokens for chain: ${chainName}`);

    let result;

    if (parsedParams.contractAddress) {
      // Query by contractAddress
      result = await query(
        `SELECT image
         FROM tokens
         WHERE (detail_platforms->'${chainName}'->>'contract_address' = $1
                OR detail_platforms->''->>'contract_address' = $1)`,
        [parsedParams.contractAddress.toLowerCase()]
      );
    } else if (parsedParams.symbol) {
      // Query by symbol
      result = await query(
        `SELECT image
         FROM tokens
         WHERE symbol = $1
           AND (detail_platforms->'${chainName}'->>'contract_address' IS NOT NULL
                OR detail_platforms->''->>'contract_address' IS NOT NULL)`,
        [parsedParams.symbol.toLowerCase()]
      );
    }

    if (result.rows.length > 0 && result.rows[0].image) {
      logger.info(`Found image for ${contractAddress || symbol}: ${result.rows[0].image}`);
      return NextResponse.json({
        success: true,
        data: { image: result.rows[0].image },
      });
    }

    logger.warn(`No image found for ${contractAddress || symbol} on chain ${chainName}`);
    return NextResponse.json({
      success: false,
      error: 'Token image not found in database',
    }, { status: 404 });
  } catch (err) {
    logger.error('Error fetching token image:', err.message);
    return NextResponse.json({
      success: false,
      error: `Failed to fetch token image: ${err.message}`,
    }, { status: 500 });
  }
}