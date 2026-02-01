/**
 * Home Assistant API client
 * Supports both OAuth2 (external) and trusted networks (embedded) authentication
 */

import prisma from '@/lib/db';
import {
  isPrintStatusEntity,
  buildPrintStatusPattern,
  buildAmsPattern,
  buildTrayPattern,
  buildExternalSpoolPattern,
  buildCurrentStagePattern,
  buildPrintWeightPattern,
  buildPrintProgressPattern,
  cleanFriendlyName,
} from '@/lib/entity-patterns';

export interface HAState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

export interface HAAutomation {
  id: string;
  alias: string;
  description?: string;
  trigger: unknown[];
  condition?: unknown[];
  action: unknown[];
  mode?: string;
}

export interface HAPrinter {
  entity_id: string;
  name: string;
  state: string;
  ams_units: HAAMS[];
  external_spool?: HATray;
  // Additional entities needed for automation YAML generation
  // These are discovered dynamically to handle localized entity names
  current_stage_entity?: string;
  print_weight_entity?: string;
  print_progress_entity?: string;
}

export interface HAAMS {
  entity_id: string;
  name: string;
  trays: HATray[];
}

export interface HATray {
  entity_id: string;
  tray_number: number;
  name?: string;  // Filament name from RFID (e.g., "Matte Dark Blue")
  color?: string;
  material?: string;
  tray_uuid?: string;  // Spool serial number (unique per physical spool)
  remaining_weight?: number;
}

/**
 * Check if running in embedded HA mode
 */
export function isEmbeddedMode(): boolean {
  return process.env.HA_MODE === 'embedded';
}

/**
 * Get the embedded HA URL
 */
export function getEmbeddedHAUrl(): string {
  return process.env.HA_URL || 'http://homeassistant:8123';
}

/**
 * Onboarding status response
 */
interface OnboardingStep {
  step: string;
  done: boolean;
}

/**
 * Check if HA needs onboarding (accessible without auth)
 */
export async function checkHAOnboardingStatus(baseUrl: string): Promise<{ needsOnboarding: boolean; steps?: string[]; error?: string }> {
  try {
    console.log(`Checking HA onboarding status at ${baseUrl}/api/onboarding`);
    const response = await fetch(`${baseUrl}/api/onboarding`);
    console.log(`Onboarding check response: ${response.status}`);

    if (response.status === 404) {
      // Onboarding complete - API returns 404 when done
      console.log('Onboarding already complete (404)');
      return { needsOnboarding: false };
    }
    if (response.status === 200) {
      // HA API returns an array of steps directly
      const steps: OnboardingStep[] = await response.json();
      console.log('Onboarding data:', JSON.stringify(steps));
      const pendingSteps = steps.filter(s => !s.done).map(s => s.step);
      if (pendingSteps.length > 0) {
        console.log('Onboarding needed, pending steps:', pendingSteps);
        return { needsOnboarding: true, steps: pendingSteps };
      }
      console.log('All onboarding steps complete');
      return { needsOnboarding: false };
    }
    // Unexpected status - HA might not be ready
    console.error('Unexpected onboarding status:', response.status);
    return { needsOnboarding: false, error: `Unexpected status: ${response.status}` };
  } catch (err) {
    console.error('Error checking HA onboarding:', err);
    return { needsOnboarding: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Generate a random password for HA accounts
 */
export function generateRandomPassword(length: number = 16): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  const randomValues = new Uint32Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    password += chars[randomValues[i] % chars.length];
  }
  return password;
}

/**
 * Complete HA onboarding automatically (for embedded mode)
 * Creates a service account for SpoolmanSync to use internally
 * Returns the access token and service password if successful
 */
export async function completeHAOnboarding(baseUrl: string): Promise<{
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date | null;
  servicePassword?: string;
  error?: string;
}> {
  try {
    console.log('Starting automatic HA onboarding...');

    // Generate random password for service account
    const servicePassword = generateRandomPassword();

    // Step 1: Create owner user for HA access
    // This user is used both by SpoolmanSync (via access token) and by users to login to HA
    const userResponse = await fetch(`${baseUrl}/api/onboarding/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: 'http://spoolmansync',
        name: 'Admin',
        username: 'admin',
        password: servicePassword,
        language: 'en',
      }),
    });

    if (!userResponse.ok) {
      const error = await userResponse.text();
      console.error('Failed to create user:', error);
      return { success: false, error: `Failed to create user: ${error}` };
    }

    const userData = await userResponse.json();
    const authCode = userData.auth_code;
    console.log('User created, got auth code');

    // Step 2: Exchange auth code for tokens
    const tokenResponse = await fetch(`${baseUrl}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        client_id: 'http://spoolmansync',
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error('Failed to get tokens:', error);
      return { success: false, error: `Failed to get tokens: ${error}` };
    }

    const tokens = await tokenResponse.json();
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;
    console.log('Got access token');

    // Step 3: Complete core config
    await fetch(`${baseUrl}/api/onboarding/core_config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({}),
    });
    console.log('Core config done');

    // Step 4: Skip analytics
    await fetch(`${baseUrl}/api/onboarding/analytics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({}),
    });
    console.log('Analytics done');

    // Step 5: Complete integration step
    // client_id and redirect_uri are required by HA's schema
    await fetch(`${baseUrl}/api/onboarding/integration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        client_id: 'http://spoolmansync',
        redirect_uri: `${baseUrl}/`,
      }),
    });
    console.log('Integration done');

    console.log('HA onboarding completed successfully!');
    // Calculate token expiry (HA tokens typically expire in 30 min)
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;
    return { success: true, accessToken, refreshToken, expiresAt, servicePassword };
  } catch (err) {
    console.error('Error during HA onboarding:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export class HomeAssistantClient {
  private baseUrl: string;
  private clientId: string;
  private accessToken: string | null;
  private refreshToken: string | null;
  private expiresAt: Date | null;
  private embeddedMode: boolean;

  constructor(
    baseUrl: string,
    accessToken?: string | null,
    refreshToken?: string | null,
    expiresAt?: Date | null,
    embeddedMode: boolean = false,
    clientId: string = 'http://spoolmansync'
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.clientId = clientId;
    this.accessToken = accessToken || null;
    this.refreshToken = refreshToken || null;
    this.expiresAt = expiresAt || null;
    this.embeddedMode = embeddedMode;
  }

  /**
   * Create a client for embedded mode (trusted networks, no auth needed)
   */
  static forEmbedded(): HomeAssistantClient {
    return new HomeAssistantClient(
      getEmbeddedHAUrl(),
      null,
      null,
      null,
      true
    );
  }

  /**
   * Create a client from the stored connection or embedded mode
   * Returns null if no valid connection/credentials exist
   */
  static async fromConnection(): Promise<HomeAssistantClient | null> {
    // Check for stored connection first (works for both embedded and external)
    const connection = await prisma.hAConnection.findFirst();

    if (isEmbeddedMode()) {
      const haUrl = getEmbeddedHAUrl();
      // In embedded mode, require stored credentials from auto-onboarding
      if (connection) {
        return new HomeAssistantClient(
          haUrl,
          connection.accessToken,
          connection.refreshToken,
          connection.expiresAt,
          true,
          connection.clientId
        );
      }
      // No stored connection - auto-onboarding hasn't completed yet
      // The settings API handles onboarding, so return null here
      return null;
    }

    // External mode - require stored connection
    if (!connection) return null;

    return new HomeAssistantClient(
      connection.url,
      connection.accessToken,
      connection.refreshToken,
      connection.expiresAt,
      false,
      connection.clientId
    );
  }

  /**
   * Refresh the access token if expired
   */
  private async ensureValidToken(): Promise<void> {
    // If no expiry set or not expired, token is valid
    if (!this.expiresAt || new Date() < this.expiresAt) {
      return;
    }

    // If no refresh token, can't refresh
    if (!this.refreshToken) {
      throw new Error('Access token expired and no refresh token available');
    }

    // Refresh the token
    // Note: HA requires client_id for refresh token requests (must match original OAuth client_id)
    const response = await fetch(`${this.baseUrl}/auth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: this.clientId,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to refresh access token');
    }

    const tokens = await response.json();
    this.accessToken = tokens.access_token;
    this.expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;

    // Update stored tokens (only if we have a token)
    if (this.accessToken) {
      await prisma.hAConnection.updateMany({
        data: {
          accessToken: this.accessToken,
          expiresAt: this.expiresAt,
        },
      });
    }
  }

  private async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    // Ensure token is valid before making request (only for OAuth mode)
    await this.ensureValidToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers as Record<string, string>,
    };

    // Add auth header if we have a token
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${this.baseUrl}/api${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HA API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Check if connection is valid
   */
  async checkConnection(): Promise<boolean> {
    try {
      // Ensure token is fresh before checking
      await this.ensureValidToken();

      const headers: Record<string, string> = {};
      if (this.accessToken) {
        headers['Authorization'] = `Bearer ${this.accessToken}`;
      }

      const response = await fetch(`${this.baseUrl}/api/`, { headers });
      console.log(`HA connection check to ${this.baseUrl}/api/ - status: ${response.status}`);
      return response.ok;
    } catch (err) {
      console.error(`HA connection check failed:`, err);
      return false;
    }
  }

  /**
   * Get all states
   */
  async getStates(): Promise<HAState[]> {
    return this.fetch('/states');
  }

  /**
   * Get states for a specific entity
   */
  async getState(entityId: string): Promise<HAState> {
    return this.fetch(`/states/${entityId}`);
  }

  /**
   * Discover Bambu Lab printers from HA entities
   */
  async discoverPrinters(): Promise<HAPrinter[]> {
    const states = await this.getStates();
    const printers: HAPrinter[] = [];

    // Find printer entities using centralized localized patterns
    // See src/lib/entity-patterns.ts to add support for more languages
    const printerStates = states.filter(s => isPrintStatusEntity(s.entity_id));

    for (const printerState of printerStates) {
      // Extract printer prefix using centralized patterns
      const match = printerState.entity_id.match(buildPrintStatusPattern());
      if (!match) continue;

      const prefix = match[1];
      const printer: HAPrinter = {
        entity_id: printerState.entity_id,
        name: cleanFriendlyName(printerState.attributes.friendly_name as string, prefix),
        state: printerState.state,
        ams_units: [],
      };

      // Find AMS units for this printer
      // Group by AMS number and prefer highest suffix number (newer ha-bambulab versions use _2, _3, etc.)
      // Uses centralized localized patterns - see src/lib/entity-patterns.ts
      const amsPattern = buildAmsPattern(prefix);
      const amsStates = states.filter(s => amsPattern.test(s.entity_id));

      // Helper to extract entity suffix number (0 if no suffix)
      const getEntitySuffix = (entityId: string): number => {
        const suffixMatch = entityId.match(/_(\d+)$/);
        return suffixMatch ? parseInt(suffixMatch[1], 10) : 0;
      };

      // Group AMS entities by their AMS number
      const amsByNumber = new Map<string, HAState[]>();
      for (const amsState of amsStates) {
        const amsMatch = amsState.entity_id.match(amsPattern);
        if (!amsMatch) continue;
        const amsNumber = amsMatch[1];
        if (!amsByNumber.has(amsNumber)) {
          amsByNumber.set(amsNumber, []);
        }
        amsByNumber.get(amsNumber)!.push(amsState);
      }

      // Process each unique AMS number, picking the best entity
      for (const [amsNumber, candidates] of amsByNumber) {
        // Pick the best candidate: prefer available entities, then prefer highest suffix number
        const bestAmsState = candidates.reduce((best, current) => {
          const bestAvailable = best.state !== 'unavailable' && best.state !== 'unknown';
          const currentAvailable = current.state !== 'unavailable' && current.state !== 'unknown';

          // Prefer available over unavailable
          if (currentAvailable && !bestAvailable) return current;
          if (bestAvailable && !currentAvailable) return best;

          // Both same availability - prefer highest suffix number (most recent version)
          const currentSuffix = getEntitySuffix(current.entity_id);
          const bestSuffix = getEntitySuffix(best.entity_id);
          if (currentSuffix > bestSuffix) return current;

          return best;
        });

        const ams: HAAMS = {
          entity_id: bestAmsState.entity_id,
          name: `AMS ${amsNumber}`,
          trays: [],
        };

        // Find trays for this AMS (newer versions use _2, _3, etc. suffix)
        // Uses centralized localized patterns - see src/lib/entity-patterns.ts
        for (let trayNum = 1; trayNum <= 4; trayNum++) {
          const trayPattern = buildTrayPattern(prefix, amsNumber, trayNum);
          const trayCandidates = states.filter(s => trayPattern.test(s.entity_id));

          if (trayCandidates.length > 0) {
            // Pick the best: prefer available, then prefer highest suffix number
            const bestTray = trayCandidates.reduce((best, current) => {
              const bestAvailable = best.state !== 'unavailable' && best.state !== 'unknown';
              const currentAvailable = current.state !== 'unavailable' && current.state !== 'unknown';

              if (currentAvailable && !bestAvailable) return current;
              if (bestAvailable && !currentAvailable) return best;

              // Both same availability - prefer highest suffix number
              const currentSuffix = getEntitySuffix(current.entity_id);
              const bestSuffix = getEntitySuffix(best.entity_id);
              if (currentSuffix > bestSuffix) return current;
              return best;
            });

            ams.trays.push({
              entity_id: bestTray.entity_id,
              tray_number: trayNum,
              name: bestTray.attributes.name as string,  // Filament name from RFID
              color: bestTray.attributes.color as string,
              material: bestTray.attributes.type as string,
              tray_uuid: bestTray.attributes.tray_uuid as string,  // Spool serial number
              remaining_weight: bestTray.attributes.remain as number,
            });
          }
        }

        printer.ams_units.push(ams);
      }

      // Find external spool using centralized localized patterns
      // See src/lib/entity-patterns.ts to add support for more languages
      const extPattern = buildExternalSpoolPattern(prefix);
      const extCandidates = states.filter(s => extPattern.test(s.entity_id));

      if (extCandidates.length > 0) {
        // Pick the best: prefer available, then prefer highest suffix number
        const bestExt = extCandidates.reduce((best, current) => {
          const bestAvailable = best.state !== 'unavailable' && best.state !== 'unknown';
          const currentAvailable = current.state !== 'unavailable' && current.state !== 'unknown';

          if (currentAvailable && !bestAvailable) return current;
          if (bestAvailable && !currentAvailable) return best;

          const currentSuffix = getEntitySuffix(current.entity_id);
          const bestSuffix = getEntitySuffix(best.entity_id);
          if (currentSuffix > bestSuffix) return current;
          return best;
        });

        printer.external_spool = {
          entity_id: bestExt.entity_id,
          tray_number: 0,
          name: bestExt.attributes.name as string,
          color: bestExt.attributes.color as string,
          material: bestExt.attributes.type as string,
          tray_uuid: bestExt.attributes.tray_uuid as string,  // Spool serial number
          remaining_weight: bestExt.attributes.remain as number,
        };
      }

      // Discover additional entities needed for automation YAML generation
      // These are found dynamically to handle localized entity names
      const currentStagePattern = buildCurrentStagePattern(prefix);
      const currentStageEntity = states.find(s => currentStagePattern.test(s.entity_id));
      if (currentStageEntity) {
        printer.current_stage_entity = currentStageEntity.entity_id;
      }

      const printWeightPattern = buildPrintWeightPattern(prefix);
      const printWeightEntity = states.find(s => printWeightPattern.test(s.entity_id));
      if (printWeightEntity) {
        printer.print_weight_entity = printWeightEntity.entity_id;
      }

      const printProgressPattern = buildPrintProgressPattern(prefix);
      const printProgressEntity = states.find(s => printProgressPattern.test(s.entity_id));
      if (printProgressEntity) {
        printer.print_progress_entity = printProgressEntity.entity_id;
      }

      printers.push(printer);
    }

    return printers;
  }

  /**
   * Create an automation
   */
  async createAutomation(automation: HAAutomation): Promise<void> {
    await this.fetch('/services/automation/reload', { method: 'POST' });
    // Note: Creating automations via API requires config file modifications
    // We'll use the automation config entry instead
  }

  /**
   * Call a webhook
   */
  async callWebhook(webhookId: string, data: Record<string, unknown>): Promise<void> {
    await fetch(`${this.baseUrl}/api/webhook/${webhookId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
  }

  /**
   * Fire an event
   */
  async fireEvent(eventType: string, eventData: Record<string, unknown>): Promise<void> {
    await this.fetch(`/events/${eventType}`, {
      method: 'POST',
      body: JSON.stringify(eventData),
    });
  }

  /**
   * Call a Home Assistant service
   */
  async callService(
    domain: string,
    service: string,
    serviceData: Record<string, unknown> = {}
  ): Promise<void> {
    await this.fetch(`/services/${domain}/${service}`, {
      method: 'POST',
      body: JSON.stringify(serviceData),
    });
  }

  // ============================================
  // Config Flow API (for setting up integrations)
  // ============================================

  /**
   * Start a new config flow for an integration
   */
  async startConfigFlow(domain: string): Promise<ConfigFlowResult> {
    return this.fetch('/config/config_entries/flow', {
      method: 'POST',
      body: JSON.stringify({ handler: domain }),
    });
  }

  /**
   * Continue a config flow with user input
   * Note: HA returns 400 with errors object for validation failures
   */
  async continueConfigFlow(flowId: string, userInput: Record<string, unknown>): Promise<ConfigFlowResult> {
    await this.ensureValidToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add auth header if we have a token
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${this.baseUrl}/api/config/config_entries/flow/${flowId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(userInput),
    });

    // For config flows, 400 errors typically mean validation failed
    if (response.status === 400) {
      const errorBody = await response.json();
      console.log('Config flow 400 response:', JSON.stringify(errorBody));

      // If the response contains full form data (data_schema, step_id), return it as-is
      // This handles cases where HA returns 400 but with a valid form to display
      if (errorBody.data_schema && errorBody.step_id) {
        return errorBody as ConfigFlowResult;
      }

      // If it just has errors, return a synthetic form result with the current step
      // but mark it specially so frontend knows it's a validation error
      if (errorBody.errors) {
        return {
          flow_id: flowId,
          type: 'form',
          handler: 'bambu_lab',
          step_id: 'error',
          errors: errorBody.errors,
        } as ConfigFlowResult;
      }

      throw new Error(`HA API error: ${response.status} - ${JSON.stringify(errorBody)}`);
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HA API error: ${response.status} - ${error}`);
    }

    const result = await response.json();
    console.log('Config flow response:', JSON.stringify({ type: result.type, step_id: result.step_id, hasErrors: !!result.errors }));
    return result;
  }

  /**
   * Get the current state of a config flow
   */
  async getConfigFlow(flowId: string): Promise<ConfigFlowResult> {
    return this.fetch(`/config/config_entries/flow/${flowId}`);
  }

  /**
   * Delete/abort a config flow
   */
  async deleteConfigFlow(flowId: string): Promise<void> {
    await this.fetch(`/config/config_entries/flow/${flowId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Get all config entries for a domain
   */
  async getConfigEntries(domain?: string): Promise<ConfigEntry[]> {
    const url = domain
      ? `/config/config_entries/entry?domain=${domain}`
      : '/config/config_entries/entry';
    return this.fetch(url);
  }

  /**
   * Delete a config entry
   */
  async deleteConfigEntry(entryId: string): Promise<void> {
    await this.fetch(`/config/config_entries/entry/${entryId}`, {
      method: 'DELETE',
    });
  }

  // ============================================
  // User Management API (for embedded mode admin user)
  // ============================================

  /**
   * Get all users in Home Assistant
   */
  async getUsers(): Promise<HAUser[]> {
    // HA uses WebSocket for user listing, but we can use the REST API
    // by calling the /api/config/auth/list endpoint
    return this.fetch('/config/auth/list');
  }

  /**
   * Create a new user in Home Assistant
   */
  async createUser(name: string, username: string, password: string, isAdmin: boolean = false): Promise<HAUser> {
    return this.fetch('/config/auth/create', {
      method: 'POST',
      body: JSON.stringify({
        name,
        username,
        password,
        group_ids: isAdmin ? ['system-admin'] : ['system-users'],
        local_only: false,
      }),
    });
  }

  /**
   * Delete a user from Home Assistant
   */
  async deleteUser(userId: string): Promise<void> {
    await this.fetch('/config/auth/delete', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  }

  /**
   * Create or recreate the admin user with a new password
   * Returns the new password
   */
  async resetAdminUser(adminUsername: string = 'admin'): Promise<{ userId: string; password: string }> {
    // First, try to find and delete existing admin user
    try {
      const users = await this.getUsers();
      const existingAdmin = users.find(u => u.username === adminUsername);
      if (existingAdmin) {
        console.log(`Deleting existing admin user: ${existingAdmin.id}`);
        await this.deleteUser(existingAdmin.id);
      }
    } catch (err) {
      console.log('No existing admin user to delete or error listing users:', err);
    }

    // Create new admin user with random password
    const newPassword = generateRandomPassword();
    const newUser = await this.createUser(
      'Admin',
      adminUsername,
      newPassword,
      true // isAdmin
    );

    console.log(`Created new admin user: ${newUser.id}`);
    return { userId: newUser.id, password: newPassword };
  }
}

// Config flow types
export interface ConfigFlowResult {
  flow_id: string;
  type: 'form' | 'create_entry' | 'abort' | 'external' | 'external_done' | 'menu';
  handler: string;
  step_id: string;
  data_schema?: ConfigFlowSchema[];
  errors?: Record<string, string>;
  description_placeholders?: Record<string, string>;
  title?: string;
  result?: ConfigEntry;
  menu_options?: string[];
  reason?: string; // Abort reason when type is 'abort'
}

export interface ConfigFlowSchema {
  name: string;
  type: string;
  required?: boolean;
  default?: unknown;
  description?: { suggested_value?: unknown };
}

export interface ConfigEntry {
  entry_id: string;
  domain: string;
  title: string;
  source: string;
  state: string;
  supports_options: boolean;
  supports_remove_device: boolean;
  supports_unload: boolean;
  disabled_by: string | null;
}

export interface HAUser {
  id: string;
  username: string;
  name: string;
  is_owner: boolean;
  is_active: boolean;
  local_only: boolean;
  system_generated: boolean;
  group_ids: string[];
  credentials: Array<{ type: string }>;
}
