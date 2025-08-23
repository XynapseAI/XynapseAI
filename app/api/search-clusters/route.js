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
    const rateLimitResult = await checkRateLimit(request, "search-clusters", 30, 60000);
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
    const cacheKey = `clusters_search_${searchQuery.trim().toLowerCase()}`;
    const cacheTTL = 5 * 60; // Cache for 5 minutes

    // Check Redis cache
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      logger.log("Cluster search cache hit", {
        query: searchQuery,
        cacheKey,
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json(JSON.parse(cachedData));
    }

    const searchTerm = `%${searchQuery.trim().toLowerCase()}%`;

    // SQL query for distinct exchange_names and image
    const searchSql = `
      SELECT exchange_name, MAX(image) as image
      FROM wallet_holders 
      WHERE LOWER(exchange_name) LIKE $1 
      GROUP BY exchange_name
      ORDER BY exchange_name ASC
      LIMIT 20
    `;

    const results = await query(searchSql, [searchTerm]);

    const responseData = {
      success: true,
      data: results.rows,
      count: results.rows.length,
    };

    // Store in Redis
    await redisClient.setEx(cacheKey, cacheTTL, JSON.stringify(responseData));

    logger.log("Cluster search completed", {
      query: searchQuery,
      resultCount: results.rows.length,
      cacheKey,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json(responseData);
  } catch (error) {
    logger.error("Error in cluster search:", {
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