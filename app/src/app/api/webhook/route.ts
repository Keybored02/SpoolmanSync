import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { SpoolmanClient } from '@/lib/api/spoolman';
import { spoolEvents, SPOOL_UPDATED, SpoolUpdateEvent } from '@/lib/events';
import { createActivityLog } from '@/lib/activity-log';

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
    const { event } = body;

    const spoolmanConnection = await prisma.spoolmanConnection.findFirst();

    if (!spoolmanConnection) {
      console.warn('Webhook received but Spoolman not configured');
      return NextResponse.json({ status: 'ignored', reason: 'spoolman not configured' });
    }

    const client = new SpoolmanClient(spoolmanConnection.url);

    // Handle spool_usage event - deduct filament weight from spool
    if (event === 'spool_usage') {
      const { used_weight, active_tray_id, tag_uid } = body;

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

      // Store the RFID tag if we have a valid one from the printer
      // This enables future auto-matching when the same spool is reinserted
      // Due to Bambu firmware bug, the same spool can report different tag_uids
      // depending on which tray it's in, so we accumulate multiple tags per spool
      let tagStored = false;
      if (tag_uid && tag_uid !== 'unknown' && tag_uid !== '') {
        // Check if this specific tag is already stored on this spool
        const existingTagsRaw = matchedSpool.extra?.['tag'];
        let alreadyHasThisTag = false;
        if (existingTagsRaw) {
          try {
            const parsed = JSON.parse(existingTagsRaw);
            if (parsed && parsed !== '') {
              const existingTags = parsed.split(',').map((t: string) => t.trim());
              alreadyHasThisTag = existingTags.includes(tag_uid);
            }
          } catch {
            // If parsing fails, assume tag not stored
          }
        }

        if (!alreadyHasThisTag) {
          console.log(`Storing RFID tag "${tag_uid}" on spool #${matchedSpool.id}`);
          await client.setSpoolTag(matchedSpool.id, tag_uid);
          tagStored = true;

          await createActivityLog({
            type: 'tag_stored',
            message: `Stored RFID tag on spool #${matchedSpool.id} (${matchedSpool.filament.name})`,
            details: {
              spoolId: matchedSpool.id,
              tagUid: tag_uid,
            },
          });
        }
      }

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

      await createActivityLog({
        type: 'spool_usage',
        message: `Deducted ${used_weight}g from spool #${matchedSpool.id} (${matchedSpool.filament.name})`,
        details: {
          spoolId: matchedSpool.id,
          usedWeight: used_weight,
          trayId: active_tray_id,
          tagStored,
        },
      });

      return NextResponse.json({
        status: 'success',
        spoolId: matchedSpool.id,
        deducted: used_weight,
        newRemainingWeight: matchedSpool.remaining_weight - used_weight,
        tagStored,
      });
    }

    // Handle tray_change event - auto-assign spool by RFID tag or handle empty tray
    if (event === 'tray_change') {
      const { tray_entity_id, tag_uid, name, material } = body;
      const spools = await client.getSpools();

      // Check if tray is now empty (no filament, or explicitly "Empty")
      // ha-bambulab reports name="Empty" when tray has no filament
      const trayIsEmpty = !name || name.toLowerCase() === 'empty' || name === '';

      if (trayIsEmpty) {
        // Auto-unassign any spool currently assigned to this tray
        const jsonTrayId = JSON.stringify(tray_entity_id);
        const assignedSpool = spools.find(s => s.extra?.['active_tray'] === jsonTrayId);

        if (assignedSpool) {
          console.log(`Tray ${tray_entity_id} is now empty, unassigning spool #${assignedSpool.id}`);
          await client.unassignSpoolFromTray(assignedSpool.id);

          // Emit real-time update event
          const updateEvent: SpoolUpdateEvent = {
            type: 'unassign',
            spoolId: assignedSpool.id,
            spoolName: assignedSpool.filament.name,
            trayId: tray_entity_id,
            timestamp: Date.now(),
          };
          spoolEvents.emit(SPOOL_UPDATED, updateEvent);

          await createActivityLog({
            type: 'spool_unassign',
            message: `Auto-unassigned spool #${assignedSpool.id} from ${tray_entity_id} (tray empty)`,
            details: { spoolId: assignedSpool.id, trayId: tray_entity_id, reason: 'tray_empty' },
          });

          return NextResponse.json({
            status: 'success',
            action: 'unassigned',
            spoolId: assignedSpool.id,
            reason: 'tray_empty',
          });
        }

        return NextResponse.json({
          status: 'ignored',
          reason: 'tray empty and no spool was assigned',
        });
      }

      // Tray has filament - try to auto-match by RFID tag
      // Uses the `tag` field (stored on first spool_usage)
      if (tag_uid && tag_uid !== 'unknown' && tag_uid !== '') {
        const matchedSpool = await client.findSpoolByTag(tag_uid);

        if (matchedSpool) {
          await client.assignSpoolToTray(matchedSpool.id, tray_entity_id);

          // Emit real-time update event
          const updateEvent: SpoolUpdateEvent = {
            type: 'assign',
            spoolId: matchedSpool.id,
            spoolName: matchedSpool.filament.name,
            trayId: tray_entity_id,
            timestamp: Date.now(),
          };
          spoolEvents.emit(SPOOL_UPDATED, updateEvent);

          await createActivityLog({
            type: 'spool_change',
            message: `Auto-assigned spool #${matchedSpool.id} to ${tray_entity_id} (matched by RFID tag)`,
            details: { spoolId: matchedSpool.id, trayId: tray_entity_id, matchedBy: 'rfid_tag', tagUid: tag_uid },
          });

          return NextResponse.json({
            status: 'success',
            spool: matchedSpool,
            matchedBy: 'rfid_tag',
          });
        }
      }

      // No auto-match - user needs to manually assign spool
      // Log what the printer detected for debugging
      console.log(`Tray ${tray_entity_id} changed but no matching spool found. Printer reports: name="${name}", material="${material}", tag_uid="${tag_uid}"`);

      // Emit tray_change event so dashboard can refresh and show warning banner
      const updateEvent: SpoolUpdateEvent = {
        type: 'tray_change',
        trayId: tray_entity_id,
        timestamp: Date.now(),
      };
      spoolEvents.emit(SPOOL_UPDATED, updateEvent);

      return NextResponse.json({
        status: 'no_match',
        message: 'No spool assigned to this tray. Please assign a spool manually in SpoolmanSync.',
        printerReports: { name, material, tag_uid },
      });
    }

    return NextResponse.json({ status: 'ignored', reason: 'unknown event type' });
  } catch (error) {
    console.error('Webhook error:', error);

    await createActivityLog({
      type: 'error',
      message: 'Webhook processing failed',
      details: { error: error instanceof Error ? error.message : String(error) },
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
