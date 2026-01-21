import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { SpoolmanClient } from '@/lib/api/spoolman';
import { spoolEvents, SPOOL_UPDATED, SpoolUpdateEvent } from '@/lib/events';

/**
 * Webhook endpoint for Home Assistant automations
 *
 * This endpoint receives tray change events from HA and syncs with Spoolman.
 *
 * Expected payload:
 * {
 *   event: "tray_change",
 *   tray_entity_id: "sensor.x1c_..._tray_1_2",
 *   tag_uid: "...",
 *   color: "#FFFFFF",
 *   material: "PLA",
 *   remaining_weight: 800
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('Webhook received:', body);

    const { event } = body;

    // Log the webhook event
    await prisma.activityLog.create({
      data: {
        type: 'webhook',
        message: `Received ${event} event`,
        details: JSON.stringify(body),
      },
    });

    const spoolmanConnection = await prisma.spoolmanConnection.findFirst();

    if (!spoolmanConnection) {
      console.warn('Webhook received but Spoolman not configured');
      return NextResponse.json({ status: 'ignored', reason: 'spoolman not configured' });
    }

    const client = new SpoolmanClient(spoolmanConnection.url);

    // Handle spool_usage event - deduct filament weight from spool
    if (event === 'spool_usage') {
      const { used_weight, active_tray_id } = body;

      if (!used_weight || used_weight <= 0) {
        return NextResponse.json({ status: 'ignored', reason: 'no weight to deduct' });
      }

      if (!active_tray_id) {
        return NextResponse.json({ status: 'ignored', reason: 'no active_tray_id provided' });
      }

      const spools = await client.getSpools();

      // Match by active_tray_id - this is set when users assign spools to trays in our UI
      // Works for ALL spool vendors (not dependent on Bambu RFID tags)
      const jsonTrayId = JSON.stringify(active_tray_id);
      const matchedSpool = spools.find(s => s.extra?.['active_tray'] === jsonTrayId);

      if (!matchedSpool) {
        console.warn(`No spool assigned to tray ${active_tray_id}`);
        return NextResponse.json({
          status: 'no_match',
          message: `No spool assigned to tray ${active_tray_id}. Assign a spool in SpoolmanSync first.`,
        });
      }

      // Deduct the used weight from the spool
      await client.useWeight(matchedSpool.id, used_weight);

      console.log(`Deducted ${used_weight}g from spool #${matchedSpool.id} (${matchedSpool.filament.name})`);

      // Emit real-time update event for dashboard
      const updateEvent: SpoolUpdateEvent = {
        type: 'usage',
        spoolId: matchedSpool.id,
        spoolName: matchedSpool.filament.name,
        deducted: used_weight,
        newWeight: matchedSpool.remaining_weight - used_weight,
        trayId: active_tray_id,
        timestamp: Date.now(),
      };
      spoolEvents.emit(SPOOL_UPDATED, updateEvent);

      await prisma.activityLog.create({
        data: {
          type: 'spool_usage',
          message: `Deducted ${used_weight}g from spool #${matchedSpool.id} (${matchedSpool.filament.name})`,
          details: JSON.stringify({
            spoolId: matchedSpool.id,
            usedWeight: used_weight,
            trayId: active_tray_id,
          }),
        },
      });

      return NextResponse.json({
        status: 'success',
        spoolId: matchedSpool.id,
        deducted: used_weight,
        newRemainingWeight: matchedSpool.remaining_weight - used_weight,
      });
    }

    // Handle tray_change event - auto-assign spool by tag_uid
    if (event === 'tray_change') {
      const { tray_entity_id, tag_uid } = body;
      const spools = await client.getSpools();

      // Auto-match by tag_uid only (if user has set tag_uid in Spoolman's extra field)
      // We intentionally don't match by color/material as it's unreliable when users
      // have multiple spools of the same type. Users should manually assign spools.
      if (tag_uid && tag_uid !== 'unknown' && tag_uid !== '') {
        const jsonTagUid = JSON.stringify(tag_uid);
        const matchedSpool = spools.find(s => s.extra?.['tag_uid'] === jsonTagUid);

        if (matchedSpool) {
          await client.assignSpoolToTray(matchedSpool.id, tray_entity_id);

          await prisma.activityLog.create({
            data: {
              type: 'spool_change',
              message: `Auto-assigned spool #${matchedSpool.id} to ${tray_entity_id} (matched by tag UID)`,
              details: JSON.stringify({ spoolId: matchedSpool.id, trayId: tray_entity_id, matchedBy: 'tag_uid' }),
            },
          });

          return NextResponse.json({
            status: 'success',
            spool: matchedSpool,
            matchedBy: 'tag_uid',
          });
        }
      }

      // No auto-match - user needs to manually assign spool
      return NextResponse.json({
        status: 'no_match',
        message: 'No spool assigned to this tray. Please assign a spool manually in SpoolmanSync.',
      });
    }

    return NextResponse.json({ status: 'ignored', reason: 'unknown event type' });
  } catch (error) {
    console.error('Webhook error:', error);

    await prisma.activityLog.create({
      data: {
        type: 'error',
        message: 'Webhook processing failed',
        details: error instanceof Error ? error.message : String(error),
      },
    });

    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

// GET endpoint for testing/verification
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'SpoolmanSync webhook endpoint',
    events: {
      spool_usage: {
        description: 'Deduct filament weight from spool after print',
        payload: {
          event: 'spool_usage',
          name: 'Filament Name',
          material: 'PLA',
          tag_uid: '...',
          used_weight: 3.91,
          color: '#FFFFFF',
          active_tray_id: 'sensor.x1c_..._tray_1',
        },
      },
      tray_change: {
        description: 'Auto-assign spool by tag_uid (Bambu spools only)',
        payload: {
          event: 'tray_change',
          tray_entity_id: 'sensor.x1c_..._tray_1',
          tag_uid: '...',
          color: '#FFFFFF',
          material: 'PLA',
        },
      },
    },
  });
}
