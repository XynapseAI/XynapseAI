import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import {
    parseWebhookEvent,
    verifyAppKeyWithNeynar,
} from '@farcaster/miniapp-node';
import crypto from 'crypto'; // For random UUID

const prisma = new PrismaClient();

// Define types based on Farcaster docs
interface NotificationDetails {
    url: string;
    token: string;
}

interface WebhookEvent {
    event: 'miniapp_added' | 'miniapp_removed' | 'notifications_enabled' | 'notifications_disabled' | string; // Allow string for unknown events
    notificationDetails?: NotificationDetails;
}

interface WebhookData {
    fid: number;
    appFid: number;
    event: WebhookEvent;
}

// DB functions using Prisma
async function setUserNotificationDetails(fid: number, appFid: number, details: NotificationDetails) {
    try {
        await prisma.miniAppNotification.upsert({
            where: { fid_appFid: { fid: BigInt(fid), appFid: BigInt(appFid) } },
            update: { url: details.url, token: details.token, updatedAt: new Date() },
            create: {
                fid: BigInt(fid),
                appFid: BigInt(appFid),
                url: details.url,
                token: details.token,
            },
        });
        console.log(`Saved/Updated details for fid=${fid}, appFid=${appFid}`);
    } catch (error: unknown) { // Fixed: unknown instead of any
        console.error('Prisma set error:', error);
        throw error; // Bubble up to webhook handler
    }
}

async function deleteUserNotificationDetails(fid: number, appFid: number) {
    try {
        await prisma.miniAppNotification.delete({
            where: { fid_appFid: { fid: BigInt(fid), appFid: BigInt(appFid) } },
        });
        console.log(`Deleted details for fid=${fid}, appFid=${appFid}`);
    } catch (error: unknown) { // Fixed: unknown instead of any
        if ((error as { code?: string }).code === 'P2025') { // Type guard for Prisma error code
            console.log(`No details to delete for fid=${fid}, appFid=${appFid}`);
        } else {
            console.error('Prisma delete error:', error);
            throw error;
        }
    }
}

async function getUserNotificationDetails(fid: number, appFid: number): Promise<NotificationDetails | null> {
    try {
        const record = await prisma.miniAppNotification.findUnique({
            where: { fid_appFid: { fid: BigInt(fid), appFid: BigInt(appFid) } },
            select: { url: true, token: true },
        });
        return record;
    } catch (error: unknown) { // Fixed: unknown instead of any
        console.error('Prisma get error:', error);
        return null;
    }
}

// Function to send notification (from docs, adjust appUrl)
const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://xynapseai.net/dashboard'; // Must be same domain as Mini App

async function sendMiniAppNotification({
    fid,
    appFid,
    title,
    body,
}: {
    fid: number;
    appFid: number;
    title: string;
    body: string;
}): Promise<{ state: 'success' | 'no_token' | 'rate_limit' | 'error'; error?: unknown }> { // Fixed: error type unknown
    const notificationDetails = await getUserNotificationDetails(fid, appFid);
    if (!notificationDetails) {
        return { state: 'no_token' };
    }

    try {
        const response = await fetch(notificationDetails.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                notificationId: crypto.randomUUID(),
                title,
                body,
                targetUrl: appUrl,
                tokens: [notificationDetails.token],
            }),
        });

        const responseJson = await response.json();

        if (response.status === 200) {
            // Simple validation (add zod if needed for full schema)
            if (responseJson.result?.rateLimitedTokens?.length > 0) {
                return { state: 'rate_limit' };
            }
            return { state: 'success' };
        } else {
            return { state: 'error', error: responseJson };
        }
    } catch (error: unknown) { // Fixed: unknown instead of any
        console.error('Send notification error:', error);
        return { state: 'error', error };
    }
}

export async function POST(request: NextRequest) {
    const requestJson = await request.json();

    // Parse and verify the webhook event
    let data: WebhookData; // Explicit type
    try {
        data = await parseWebhookEvent(requestJson, verifyAppKeyWithNeynar) as WebhookData; // Cast to our type
    } catch (e: unknown) { // Fixed: unknown instead of any
        console.error('Webhook verification failed:', e);
        if ((e as Error).message?.includes('invalid')) {
            return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
        } else if ((e as Error).message?.includes('app key')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }

    // Extract webhook data
    const fid = data.fid;
    const appFid = data.appFid; // e.g., 309857 for Base app
    const event = data.event;

    // Handle different event types
    try {
        switch (event.event) {
            case 'miniapp_added':
                if (event.notificationDetails) {
                    await setUserNotificationDetails(fid, appFid, event.notificationDetails);
                    const sendResult = await sendMiniAppNotification({
                        fid,
                        appFid,
                        title: 'Welcome to XynapseAI Mini App',
                        body: 'Mini app is now added to your client!',
                    });
                    console.log('Send welcome result:', sendResult);
                } else {
                  console.log(`Mini App added without notifications for fid=${fid}, appFid=${appFid}`);
                }
                break;

            case 'miniapp_removed':
                await deleteUserNotificationDetails(fid, appFid);
                break;

            case 'notifications_enabled':
                if (event.notificationDetails) { // Added guard to fix type error
                    await setUserNotificationDetails(fid, appFid, event.notificationDetails);
                    const sendResult = await sendMiniAppNotification({
                        fid,
                        appFid,
                        title: 'Notifications Enabled',
                        body: 'You will now receive updates from XynapseAI!',
                    });
                    console.log('Send enabled result:', sendResult);
                }
                break;

            case 'notifications_disabled':
                await deleteUserNotificationDetails(fid, appFid);
                break;

            default:
                console.warn('Unknown event type:', (event as { event: string }).event); // Fixed: Type assertion to safely access in default (for unknown events)
        }
    } catch (error: unknown) { // Fixed: unknown instead of any
        console.error('Error processing webhook:', error);
        return NextResponse.json({ error: 'Processing error' }, { status: 500 });
    } finally {
        await prisma.$disconnect(); // Good practice in serverless
    }

    // Always return 200 OK quickly (within 10s) to avoid Base app timeout
    return NextResponse.json({ success: true }, { status: 200 });
}