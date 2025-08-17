import { NextResponse } from "next/server";
import { query } from "../../../utils/postgres";
import { logger } from "../../../utils/serverLogger";
import { getRedisClient } from "../../../lib/redis";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function checkRateLimit(request, endpoint, limit = 30, windowMs = 60000) {
  // Placeholder for rate limiting - implement Redis-based rate limiting later
  return { allowed: true };
}

export async function GET(request) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, "search-nametags", 30, 60000);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ success: false, error: "Rate limit exceeded" }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const searchQuery = searchParams.get("query");

    if (!searchQuery || searchQuery.trim().length < 2) {
      return NextResponse.json(
        {
          success: false,
          error: "Query must be at least 2 characters long",
        },
        { status: 400 },
      );
    }

    const redisClient = await getRedisClient();
    const cacheKey = `nametags_search_${searchQuery.trim().toLowerCase()}`;
    const cacheTTL = 5 * 60; // Cache for 5 minutes, matching /api/coingecko exchange-search

    // Check Redis cache
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      logger.log("Nametag search cache hit", {
        query: searchQuery,
        cacheKey,
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json(JSON.parse(cachedData));
    }

    const searchTerm = `%${searchQuery.trim().toLowerCase()}%`;
    const exactMatch = searchQuery.trim().toLowerCase();
    const startMatch = `${searchQuery.trim().toLowerCase()}%`;

    // Improved SQL query for better search accuracy
    const searchSql = `
      SELECT address, nametag, image, description, subcategory
      FROM nametags 
      WHERE LOWER(nametag) LIKE $1 
         OR LOWER(description) LIKE $1 
         OR LOWER(address) LIKE $1
         OR LOWER(subcategory) LIKE $1
      ORDER BY 
        CASE 
          WHEN LOWER(nametag) = $2 THEN 1
          WHEN LOWER(nametag) LIKE $3 THEN 2
          WHEN LOWER(address) LIKE $3 THEN 3
          WHEN LOWER(description) LIKE $1 THEN 4
          WHEN LOWER(subcategory) LIKE $1 THEN 5
          ELSE 6
        END,
        nametag ASC
      LIMIT 20
    `;

    const results = await query(searchSql, [searchTerm, exactMatch, startMatch]);

    const responseData = {
      success: true,
      data: results.rows,
      count: results.rows.length,
    };

    // Store in Redis
    await redisClient.setEx(cacheKey, cacheTTL, JSON.stringify(responseData));

    logger.log("Nametag search completed", {
      query: searchQuery,
      resultCount: results.rows.length,
      cacheKey,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json(responseData);
  } catch (error) {
    logger.error("Error in nametag search:", {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      { status: 500 },
    );
  }
}