'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Nav } from '@/components/nav';
import { QRScanner } from '@/components/qr-scanner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import type { Spool } from '@/lib/api/spoolman';

interface TrayOption {
  id: string;
  label: string;
  printer: string;
}

function ScanPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [spool, setSpool] = useState<Spool | null>(null);
  const [trays, setTrays] = useState<TrayOption[]>([]);
  const [selectedTray, setSelectedTray] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualBarcode, setManualBarcode] = useState('');

  const handleScan = useCallback(async (scannedData: string) => {
    setLoading(true);
    setError(null);
    setSpool(null);

    try {
      // Try to extract spool ID from various formats
      let spoolId: string | null = null;
      const trimmedData = scannedData.trim();

      // 1. Spoolman QR code format: web+spoolman:s-ID
      const spoolmanMatch = trimmedData.match(/web\+spoolman:s-(\d+)/i);
      if (spoolmanMatch) {
        spoolId = spoolmanMatch[1];
      }

      // 2. URL format: http(s)://hostname/spool/show/ID
      if (!spoolId) {
        const urlMatch = trimmedData.match(/\/spool\/show\/(\d+)/i);
        if (urlMatch) {
          spoolId = urlMatch[1];
        }
      }

      // 3. Plain number (assume it's a spool ID)
      if (!spoolId && /^\d+$/.test(trimmedData)) {
        spoolId = trimmedData;
      }

      // Fetch all spools
      const res = await fetch('/api/spools');
      if (!res.ok) throw new Error('Failed to fetch spools');

      const data = await res.json();
      const spools: Spool[] = data.spools || [];

      let matchedSpool: Spool | undefined;

      if (spoolId) {
        // Match by ID
        matchedSpool = spools.find((s) => s.id.toString() === spoolId);
      }

      // 4. If no ID match, try matching by barcode in extra field
      if (!matchedSpool) {
        matchedSpool = spools.find((s) => {
          if (!s.extra?.['barcode']) return false;
          const storedBarcode = s.extra['barcode'];
          // Compare with raw value and JSON-encoded value
          return storedBarcode === trimmedData ||
                 storedBarcode === JSON.stringify(trimmedData) ||
                 storedBarcode === `"${trimmedData}"`;
        });
      }

      if (matchedSpool) {
        setSpool(matchedSpool);
        toast.success(`Found spool #${matchedSpool.id}`);
      } else {
        setError(`No spool found for: ${scannedData}`);
        toast.error('No matching spool found');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to look up spool');
      toast.error('Failed to look up spool');
    } finally {
      setLoading(false);
    }
  }, []);

  // Check for barcode in URL params
  useEffect(() => {
    const barcode = searchParams.get('barcode');
    if (barcode) {
      handleScan(barcode);
    }
  }, [searchParams, handleScan]);

  // Fetch trays for assignment
  useEffect(() => {
    fetchTrays();
  }, []);

  const fetchTrays = async () => {
    try {
      const res = await fetch('/api/printers');
      if (!res.ok) return;

      const data = await res.json();
      const trayOptions: TrayOption[] = [];

      for (const printer of data.printers || []) {
        for (const ams of printer.ams_units || []) {
          for (const tray of ams.trays || []) {
            trayOptions.push({
              id: tray.entity_id,
              label: `${ams.name} Tray ${tray.tray_number}`,
              printer: printer.name,
            });
          }
        }
        if (printer.external_spool) {
          trayOptions.push({
            id: printer.external_spool.entity_id,
            label: 'External Spool',
            printer: printer.name,
          });
        }
      }

      setTrays(trayOptions);
    } catch (err) {
      console.error('Failed to fetch trays:', err);
    }
  };

  const handleAssign = async () => {
    if (!spool || !selectedTray) return;

    setLoading(true);
    try {
      const res = await fetch('/api/spools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spoolId: spool.id,
          trayId: selectedTray,
        }),
      });

      if (!res.ok) throw new Error('Failed to assign spool');

      toast.success('Spool assigned successfully!');
      router.push('/');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to assign spool');
    } finally {
      setLoading(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualBarcode.trim()) {
      handleScan(manualBarcode.trim());
    }
  };

  return (
    <div className="space-y-6">
      {/* QR Scanner */}
      <Card>
        <CardHeader>
          <CardTitle>Scan QR Code</CardTitle>
          <CardDescription>
            Point your camera at a Spoolman QR code or spool barcode
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QRScanner
            onScan={handleScan}
            onError={(err) => toast.error(err)}
          />
        </CardContent>
      </Card>

      {/* Manual Entry */}
      <Card>
        <CardHeader>
          <CardTitle>Manual Entry</CardTitle>
          <CardDescription>
            Enter a barcode or Spoolman spool ID manually
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleManualSubmit} className="flex gap-2">
            <Input
              placeholder="Enter spool ID, barcode, or web+spoolman:s-123"
              value={manualBarcode}
              onChange={(e) => setManualBarcode(e.target.value)}
            />
            <Button type="submit" disabled={loading || !manualBarcode.trim()}>
              {loading ? 'Looking up...' : 'Look up'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Error Display */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Spool Result */}
      {spool && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div
                className="h-6 w-6 rounded-full border"
                style={{ backgroundColor: `#${spool.filament.color_hex}` }}
              />
              Spool #{spool.id}
            </CardTitle>
            <CardDescription>
              {spool.filament.vendor.name} {spool.filament.name}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Material:</span>
                <Badge variant="secondary" className="ml-2">
                  {spool.filament.material}
                </Badge>
              </div>
              <div>
                <span className="text-muted-foreground">Remaining:</span>
                <span className="ml-2 font-medium">{spool.remaining_weight}g</span>
              </div>
            </div>

            {trays.length > 0 && (
              <div className="space-y-2 pt-4 border-t">
                <Label>Assign to Tray</Label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Select value={selectedTray} onValueChange={setSelectedTray}>
                    <SelectTrigger className="w-full sm:flex-1 min-w-0">
                      <SelectValue placeholder="Select a tray" />
                    </SelectTrigger>
                    <SelectContent>
                      {trays.map((tray) => (
                        <SelectItem key={tray.id} value={tray.id}>
                          {tray.printer} - {tray.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={handleAssign}
                    disabled={loading || !selectedTray}
                    className="w-full sm:w-auto"
                  >
                    {loading ? 'Assigning...' : 'Assign'}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function ScanPage() {
  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main className="w-full max-w-2xl mx-auto py-6 px-3 sm:px-4 md:px-6">
        <h1 className="text-2xl font-bold mb-6">Scan Spool</h1>
        <Suspense fallback={
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        }>
          <ScanPageContent />
        </Suspense>
      </main>
    </div>
  );
}
