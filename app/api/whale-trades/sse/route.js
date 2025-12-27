// app/api/whale-trades/sse/route.js
import { NextResponse } from 'next/server';
import { createClient } from 'redis';

let redisClient;
async function getRedisClient() {
    if (!redisClient) {
        redisClient = createClient({
            url: process.env.REDIS_URL_2 || 'redis://localhost:6379',
        });
        redisClient.on('error', (err) => console.error('Redis Client Error (SSE):', err));
        await redisClient.connect();
    }
    return redisClient;
}

// In-memory list of active clients (for broadcasting)
const clients = new Set();

export async function GET(request) {
    const redis = await getRedisClient();

    // SSE headers
    const headers = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
    };

    const stream = new ReadableStream({
        async start(controller) {
            clients.add(controller);
            let trades = await redis.lRange('all:whale_trades', 0, 499);
            const allTrades = trades
                .map(t => JSON.parse(t))
                .sort((a, b) => b.time - a.time);

            controller.enqueue(`data: ${JSON.stringify(allTrades)}\n\n`);

            // Listen for Redis Pub/Sub updates
            const pubsub = redis.duplicate();
            await pubsub.connect();
            await pubsub.subscribe('whale_trades_update', async (message) => {
                try {
                    let latestTrades = await redis.lRange('all:whale_trades', 0, 499);
                    const parsedTrades = latestTrades
                        .map(t => JSON.parse(t))
                        .sort((a, b) => b.time - a.time)
                        .slice(0, 500);

                    const fullMessage = JSON.stringify(parsedTrades);

                    for (const client of clients) {
                        try {
                            client.enqueue(`data: ${fullMessage}\n\n`);
                        } catch (err) {
                            clients.delete(client);
                        }
                    }
                } catch (err) {
                    console.error('Error fetching latest trades for broadcast:', err);
                }
            });

            request.signal.addEventListener('abort', () => {
                clients.delete(controller);
                pubsub.unsubscribe();
                pubsub.quit();
            });
        },
        cancel() {
            clients.delete(controller);
        }
    });

    return new NextResponse(stream, { headers });
}