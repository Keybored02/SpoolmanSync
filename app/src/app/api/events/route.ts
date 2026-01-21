import { spoolEvents, SPOOL_UPDATED, SpoolUpdateEvent } from '@/lib/events';

/**
 * Server-Sent Events endpoint for real-time dashboard updates
 *
 * Clients connect to this endpoint and receive updates when:
 * - Spool usage is deducted (from webhook)
 * - Spools are assigned/unassigned to trays
 */
export async function GET(): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection message
      const connectMessage = `data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`;
      controller.enqueue(encoder.encode(connectMessage));

      // Subscribe to spool update events
      const unsubscribe = spoolEvents.on(SPOOL_UPDATED, (data: unknown) => {
        try {
          const event = data as SpoolUpdateEvent;
          const message = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(message));
        } catch {
          // Client disconnected, will be cleaned up
        }
      });

      // Send heartbeat every 30 seconds to keep connection alive
      const heartbeatInterval = setInterval(() => {
        try {
          const heartbeat = `data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`;
          controller.enqueue(encoder.encode(heartbeat));
        } catch {
          // Client disconnected
          clearInterval(heartbeatInterval);
        }
      }, 30000);

      // Clean up on close
      // Note: The controller doesn't have a direct close event, but the stream
      // will be garbage collected when the client disconnects
      const cleanup = () => {
        unsubscribe();
        clearInterval(heartbeatInterval);
      };

      // Store cleanup function for potential manual cleanup
      (controller as unknown as { cleanup?: () => void }).cleanup = cleanup;
    },
    cancel() {
      // Stream was cancelled (client disconnected)
      console.log('SSE client disconnected');
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
