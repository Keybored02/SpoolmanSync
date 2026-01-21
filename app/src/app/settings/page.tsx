'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Nav } from '@/components/nav';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { AddPrinterDialog } from '@/components/add-printer-dialog';

interface AdminCredentials {
  username: string;
  password: string;
}

interface Settings {
  embeddedMode: boolean;
  homeassistant: {
    url: string;
    connected: boolean;
    adminCredentials?: AdminCredentials;
  } | null;
  spoolman: { url: string; connected: boolean } | null;
}

interface ConfigEntry {
  entry_id: string;
  domain: string;
  title: string;
  state: string;
}

function SettingsContent() {
  const searchParams = useSearchParams();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  // Form states
  const [haUrl, setHaUrl] = useState('');
  const [spoolmanUrl, setSpoolmanUrl] = useState('');
  const [saving, setSaving] = useState<'ha' | 'spoolman' | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Printer states
  const [printers, setPrinters] = useState<ConfigEntry[]>([]);
  const [addPrinterOpen, setAddPrinterOpen] = useState(false);
  const [removingPrinter, setRemovingPrinter] = useState<string | null>(null);

  // Admin credentials state (embedded mode)
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    fetchSettings();

    // Handle OAuth callback messages
    const success = searchParams.get('success');
    const error = searchParams.get('error');

    if (success === 'ha_connected') {
      toast.success('Home Assistant connected successfully');
      window.history.replaceState({}, '', '/settings');
    } else if (error) {
      const errorMessages: Record<string, string> = {
        missing_params: 'OAuth callback missing parameters',
        invalid_state: 'Invalid OAuth state - please try again',
        token_exchange_failed: 'Failed to exchange authorization code',
        oauth_failed: 'OAuth authentication failed',
      };
      toast.error(errorMessages[error] || 'Authentication failed');
      window.history.replaceState({}, '', '/settings');
    }
  }, [searchParams]);

  // Fetch printers only when HA is connected
  useEffect(() => {
    if (settings?.homeassistant) {
      fetchPrinters();
    }
  }, [settings?.homeassistant]);

  // Auto-refresh settings when in embedded mode and waiting for HA
  useEffect(() => {
    if (settings?.embeddedMode && !settings?.homeassistant && !loading) {
      const interval = setInterval(() => {
        fetchSettings();
      }, 3000); // Poll every 3 seconds
      return () => clearInterval(interval);
    }
  }, [settings?.embeddedMode, settings?.homeassistant, loading]);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      setSettings(data);

      if (data.homeassistant) {
        setHaUrl(data.homeassistant.url);
      }
      if (data.spoolman) {
        setSpoolmanUrl(data.spoolman.url);
      }
    } catch {
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const fetchPrinters = async () => {
    try {
      const res = await fetch('/api/printers/setup');
      if (res.ok) {
        const data = await res.json();
        setPrinters(data.entries || []);
      }
    } catch {
      // Silently fail - HA might not be connected yet
    }
  };

  const removePrinter = async (entryId: string) => {
    setRemovingPrinter(entryId);
    try {
      const res = await fetch('/api/printers/setup', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId }),
      });

      if (!res.ok) {
        throw new Error('Failed to remove printer');
      }

      toast.success('Printer removed');
      fetchPrinters();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove printer');
    } finally {
      setRemovingPrinter(null);
    }
  };

  const connectHomeAssistant = async () => {
    if (!haUrl) {
      toast.error('Please enter your Home Assistant URL');
      return;
    }

    setConnecting(true);
    try {
      const res = await fetch(`/api/auth/ha?ha_url=${encodeURIComponent(haUrl)}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to start authentication');
      }

      window.location.href = data.authUrl;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect to Home Assistant');
      setConnecting(false);
    }
  };

  const disconnectHomeAssistant = async () => {
    setSaving('ha');
    try {
      const res = await fetch('/api/settings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'homeassistant' }),
      });

      if (!res.ok) {
        throw new Error('Failed to disconnect');
      }

      toast.success('Home Assistant disconnected');
      setSettings(prev => prev ? { ...prev, homeassistant: null } : null);
      setHaUrl('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setSaving(null);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to clipboard`);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  const saveSpoolmanSettings = async () => {
    setSaving('spoolman');
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'spoolman',
          url: spoolmanUrl,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }

      toast.success('Spoolman connected successfully');
      fetchSettings();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect to Spoolman');
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Nav />
        <main className="w-full max-w-2xl mx-auto py-6 px-3 sm:px-4 md:px-6">
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main className="w-full max-w-2xl mx-auto py-6 px-3 sm:px-4 md:px-6">
        <h1 className="text-2xl font-bold mb-6">Settings</h1>

        <div className="space-y-6">
          {/* Home Assistant Settings */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className={`h-3 w-3 rounded-full ${settings?.homeassistant ? 'bg-green-500' : 'bg-gray-300'}`} />
                <CardTitle>Home Assistant</CardTitle>
                {settings?.embeddedMode && (
                  <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">
                    Embedded
                  </span>
                )}
              </div>
              <CardDescription>
                {settings?.embeddedMode
                  ? 'Home Assistant is bundled with SpoolmanSync and auto-configured.'
                  : 'Connect to your Home Assistant instance to discover Bambu Lab printers.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {settings?.embeddedMode ? (
                // Embedded mode - show status and admin credentials
                <div className="space-y-4">
                  {settings?.homeassistant ? (
                    <>
                      <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                        <div>
                          <p className="font-medium text-green-600 dark:text-green-400">Connected</p>
                          <p className="text-sm text-muted-foreground">{settings.homeassistant.url}</p>
                        </div>
                      </div>

                      {/* Admin Credentials Section */}
                      {settings.homeassistant.adminCredentials && (
                        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg space-y-3">
                          <div>
                            <p className="font-medium text-blue-700 dark:text-blue-300">Home Assistant Login</p>
                            <p className="text-sm text-blue-600 dark:text-blue-400 mt-1">
                              Use these credentials to access Home Assistant directly at{' '}
                              <a
                                href="http://localhost:8123"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline hover:no-underline"
                              >
                                localhost:8123
                              </a>
                            </p>
                          </div>

                          <div className="grid gap-2">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2">
                              <span className="text-sm text-muted-foreground">Username:</span>
                              <div className="flex items-center gap-2">
                                <code className="px-2 py-1 bg-background rounded text-sm truncate max-w-[150px] sm:max-w-none">
                                  {settings.homeassistant.adminCredentials.username}
                                </code>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 shrink-0"
                                  onClick={() => copyToClipboard(settings.homeassistant!.adminCredentials!.username, 'Username')}
                                >
                                  Copy
                                </Button>
                              </div>
                            </div>
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2">
                              <span className="text-sm text-muted-foreground">Password:</span>
                              <div className="flex items-center gap-2">
                                <code className="px-2 py-1 bg-background rounded text-sm font-mono truncate max-w-[150px] sm:max-w-none">
                                  {showPassword
                                    ? settings.homeassistant.adminCredentials.password
                                    : '••••••••••••'}
                                </code>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 shrink-0"
                                  onClick={() => setShowPassword(!showPassword)}
                                >
                                  {showPassword ? 'Hide' : 'Show'}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 shrink-0"
                                  onClick={() => copyToClipboard(settings.homeassistant!.adminCredentials!.password, 'Password')}
                                >
                                  Copy
                                </Button>
                              </div>
                            </div>
                          </div>

                          <p className="text-xs text-muted-foreground pt-2 border-t border-blue-200 dark:border-blue-800">
                            To change the password, login to Home Assistant and update it in your Profile settings.
                            SpoolmanSync uses token-based authentication, so changing the password won&apos;t affect app functionality.
                          </p>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                      <p className="font-medium text-yellow-700 dark:text-yellow-400">Connecting to Home Assistant...</p>
                      <p className="text-sm text-yellow-600 dark:text-yellow-500 mt-1">
                        Home Assistant is starting up and being configured automatically.
                        This may take up to a minute on first run.
                      </p>
                      <div className="flex items-center gap-2 mt-3">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-yellow-600" />
                        <Button variant="outline" size="sm" onClick={fetchSettings}>
                          Refresh Status
                        </Button>
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    The embedded Home Assistant is pre-configured with HACS and the Bambu Lab integration.
                    Add your printers in the Bambu Lab section below.
                  </p>
                </div>
              ) : settings?.homeassistant ? (
                // External mode - connected
                <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div>
                    <p className="font-medium">Connected</p>
                    <p className="text-sm text-muted-foreground">{settings.homeassistant.url}</p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={disconnectHomeAssistant}
                    disabled={saving === 'ha'}
                  >
                    {saving === 'ha' ? 'Disconnecting...' : 'Disconnect'}
                  </Button>
                </div>
              ) : (
                // External mode - not connected
                <>
                  <div className="space-y-2">
                    <Label htmlFor="ha-url">Home Assistant URL</Label>
                    <Input
                      id="ha-url"
                      placeholder="http://homeassistant.local:8123"
                      value={haUrl}
                      onChange={(e) => setHaUrl(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter your Home Assistant URL, then click Connect to authorize.
                    </p>
                  </div>
                  <Button
                    onClick={connectHomeAssistant}
                    disabled={connecting || !haUrl}
                  >
                    {connecting ? 'Redirecting...' : 'Connect with Home Assistant'}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <Separator />

          {/* Bambu Lab Printers */}
          {settings?.homeassistant && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Bambu Lab Printers</CardTitle>
                    <CardDescription>
                      Configure your Bambu Lab printers to sync with Spoolman.
                    </CardDescription>
                  </div>
                  <Button onClick={() => setAddPrinterOpen(true)}>
                    Add Printer
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {printers.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <p>No printers configured yet.</p>
                    <p className="text-sm mt-1">Click &quot;Add Printer&quot; to connect your Bambu Lab printer.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {printers.map((printer) => (
                      <div
                        key={printer.entry_id}
                        className="flex items-center justify-between p-3 bg-muted rounded-lg"
                      >
                        <div>
                          <p className="font-medium">{printer.title}</p>
                          <p className="text-sm text-muted-foreground">
                            {printer.state === 'loaded' ? (
                              <span className="text-green-600 dark:text-green-400">Connected</span>
                            ) : (
                              <span className="text-yellow-600 dark:text-yellow-400">{printer.state}</span>
                            )}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => removePrinter(printer.entry_id)}
                          disabled={removingPrinter === printer.entry_id}
                        >
                          {removingPrinter === printer.entry_id ? 'Removing...' : 'Remove'}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {settings?.homeassistant && <Separator />}

          {/* Spoolman Settings */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className={`h-3 w-3 rounded-full ${settings?.spoolman ? 'bg-green-500' : 'bg-gray-300'}`} />
                <CardTitle>Spoolman</CardTitle>
              </div>
              <CardDescription>
                Connect to your Spoolman instance to manage filament spools.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="spoolman-url">Spoolman URL</Label>
                <Input
                  id="spoolman-url"
                  placeholder="http://localhost:7912"
                  value={spoolmanUrl}
                  onChange={(e) => setSpoolmanUrl(e.target.value)}
                />
              </div>
              <Button
                onClick={saveSpoolmanSettings}
                disabled={saving === 'spoolman' || !spoolmanUrl}
              >
                {saving === 'spoolman' ? 'Connecting...' : settings?.spoolman ? 'Update Connection' : 'Connect'}
              </Button>
            </CardContent>
          </Card>

        </div>

        {/* Add Printer Dialog */}
        <AddPrinterDialog
          open={addPrinterOpen}
          onOpenChange={setAddPrinterOpen}
          onSuccess={fetchPrinters}
        />
      </main>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background">
        <Nav />
        <main className="w-full max-w-2xl mx-auto py-6 px-3 sm:px-4 md:px-6">
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        </main>
      </div>
    }>
      <SettingsContent />
    </Suspense>
  );
}
