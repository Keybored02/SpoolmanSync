'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Nav } from '@/components/nav';
import { PrinterCard } from '@/components/dashboard/printer-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';
import type { HAPrinter } from '@/lib/api/homeassistant';
import type { Spool } from '@/lib/api/spoolman';
import Link from 'next/link';

interface PrinterWithSpools extends HAPrinter {
  ams_units: Array<{
    entity_id: string;
    name: string;
    trays: Array<{
      entity_id: string;
      tray_number: number;
      assigned_spool?: Spool;
      [key: string]: unknown;
    }>;
  }>;
  external_spool?: {
    entity_id: string;
    tray_number: number;
    assigned_spool?: Spool;
    [key: string]: unknown;
  };
}

interface Settings {
  homeassistant: { url: string; connected: boolean } | null;
  spoolman: { url: string; connected: boolean } | null;
}

export default function Dashboard() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [printers, setPrinters] = useState<PrinterWithSpools[]>([]);
  const [spools, setSpools] = useState<Spool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Count unassigned trays
  const unassignedCount = useMemo(() => {
    let count = 0;
    for (const printer of printers) {
      for (const ams of printer.ams_units) {
        for (const tray of ams.trays) {
          if (!tray.assigned_spool) count++;
        }
      }
      // Don't count external spool as "unassigned" by default since many don't use it
    }
    return count;
  }, [printers]);

  const fetchData = useCallback(async () => {
    try {
      // Fetch settings first
      const settingsRes = await fetch('/api/settings');
      const settingsData = await settingsRes.json();
      setSettings(settingsData);

      // Only fetch printers and spools if both services are configured
      if (settingsData.homeassistant && settingsData.spoolman) {
        const [printersRes, spoolsRes] = await Promise.all([
          fetch('/api/printers'),
          fetch('/api/spools'),
        ]);

        if (printersRes.ok) {
          const printersData = await printersRes.json();
          setPrinters(printersData.printers || []);
        }

        if (spoolsRes.ok) {
          const spoolsData = await spoolsRes.json();
          setSpools(spoolsData.spools || []);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Subscribe to real-time updates via Server-Sent Events
  useEffect(() => {
    // Only connect if both services are configured
    if (!settings?.homeassistant || !settings?.spoolman) {
      return;
    }

    let eventSource: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const connect = () => {
      eventSource = new EventSource('/api/events');

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Skip heartbeat and connection messages
          if (data.type === 'heartbeat' || data.type === 'connected') {
            return;
          }

          // Refresh data when spool is updated
          if (data.type === 'usage') {
            console.log('Spool update received:', data);
            toast.info(`Filament used: ${data.deducted}g from ${data.spoolName || 'spool'}`);
            fetchData();
          }
        } catch (err) {
          console.error('Error parsing SSE message:', err);
        }
      };

      eventSource.onerror = () => {
        // Connection lost, attempt to reconnect after 5 seconds
        eventSource?.close();
        reconnectTimeout = setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      eventSource?.close();
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
    };
  }, [settings?.homeassistant, settings?.spoolman, fetchData]);

  const handleSpoolAssign = async (trayId: string, spoolId: number) => {
    try {
      const res = await fetch('/api/spools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trayId, spoolId }),
      });

      if (!res.ok) {
        throw new Error('Failed to assign spool');
      }

      toast.success('Spool assigned successfully');
      fetchData(); // Refresh data
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to assign spool');
    }
  };

  const handleSpoolUnassign = async (spoolId: number) => {
    try {
      const res = await fetch('/api/spools', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spoolId }),
      });

      if (!res.ok) {
        throw new Error('Failed to unassign spool');
      }

      toast.success('Spool unassigned');
      await fetchData(); // Refresh data - await to ensure UI updates
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to unassign spool');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Nav />
        <main className="w-full max-w-7xl mx-auto py-6 px-3 sm:px-4 md:px-6">
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <Nav />
        <main className="w-full max-w-7xl mx-auto py-6 px-3 sm:px-4 md:px-6">
          <Card className="border-destructive">
            <CardHeader>
              <CardTitle className="text-destructive">Error</CardTitle>
            </CardHeader>
            <CardContent>
              <p>{error}</p>
              <Button onClick={fetchData} className="mt-4">
                Retry
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // Show setup prompt if services aren't configured
  if (!settings?.homeassistant || !settings?.spoolman) {
    return (
      <div className="min-h-screen bg-background">
        <Nav />
        <main className="w-full max-w-7xl mx-auto py-6 px-3 sm:px-4 md:px-6">
          <Card>
            <CardHeader>
              <CardTitle>Welcome to SpoolmanSync</CardTitle>
              <CardDescription>
                Connect your Home Assistant and Spoolman to get started.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <div className={`h-3 w-3 rounded-full ${settings?.homeassistant ? 'bg-green-500' : 'bg-gray-300'}`} />
                <span>Home Assistant: {settings?.homeassistant ? 'Connected' : 'Not configured'}</span>
              </div>
              <div className="flex items-center gap-4">
                <div className={`h-3 w-3 rounded-full ${settings?.spoolman ? 'bg-green-500' : 'bg-gray-300'}`} />
                <span>Spoolman: {settings?.spoolman ? 'Connected' : 'Not configured'}</span>
              </div>
              <Link href="/settings">
                <Button>Configure Settings</Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main className="w-full max-w-7xl mx-auto py-6 px-3 sm:px-4 md:px-6">
        <div className="mb-4 sm:mb-6 flex items-center justify-between gap-2">
          <h1 className="text-xl sm:text-2xl font-bold">Dashboard</h1>
          <Button variant="outline" size="sm" onClick={fetchData}>
            Refresh
          </Button>
        </div>

        {printers.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No Printers Found</CardTitle>
              <CardDescription>
                Make sure your Bambu Lab printer is connected to Home Assistant via the ha-bambulab integration.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Show instruction banner when there are unassigned trays */}
            {unassignedCount > 0 && (
              <Alert>
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <AlertTitle>Assign Spools to Trays</AlertTitle>
                <AlertDescription>
                  You have {unassignedCount} tray{unassignedCount !== 1 ? 's' : ''} without assigned spools.
                  Click on a tray card below to select which Spoolman spool is loaded in that slot.
                  This ensures accurate filament tracking when prints complete.
                </AlertDescription>
              </Alert>
            )}

            {printers.map((printer) => (
              <PrinterCard
                key={printer.entity_id}
                printer={printer as Parameters<typeof PrinterCard>[0]['printer']}
                spools={spools}
                onSpoolAssign={handleSpoolAssign}
                onSpoolUnassign={handleSpoolUnassign}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
