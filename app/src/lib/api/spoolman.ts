/**
 * Spoolman API client
 */

export interface Vendor {
  id: number;
  name: string;
  registered: string;
}

export interface Filament {
  id: number;
  name: string;
  vendor: Vendor;
  material: string;
  color_hex: string;
  density: number;
  diameter: number;
  weight?: number;
}

export interface Spool {
  id: number;
  filament: Filament;
  remaining_weight: number;
  used_weight: number;
  initial_weight: number;
  spool_weight?: number;
  registered: string;
  first_used?: string;
  last_used?: string;
  extra: Record<string, string>;
  comment?: string;
  archived: boolean;
}

export interface UpdateTrayPayload {
  spool_id: number;
  active_tray_id: string;
}

export interface ExtraField {
  key: string;
  name: string;
  field_type: string;
  unit?: string;
  default_value?: string;
  choices?: string[];
  multi_choice?: boolean;
  order?: number;
}

export class SpoolmanClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api/v1${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Spoolman API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Check if connection is valid
   */
  async checkConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get all spools
   */
  async getSpools(): Promise<Spool[]> {
    return this.fetch('/spool');
  }

  /**
   * Get a spool by ID
   */
  async getSpool(id: number): Promise<Spool> {
    return this.fetch(`/spool/${id}`);
  }

  /**
   * Get spools currently assigned to a tray
   */
  async getSpoolsByTray(trayId: string): Promise<Spool[]> {
    const spools = await this.getSpools();
    const jsonTrayId = JSON.stringify(trayId);
    return spools.filter(s => s.extra?.['active_tray'] === jsonTrayId);
  }

  /**
   * Assign a spool to a tray
   */
  async assignSpoolToTray(spoolId: number, trayId: string): Promise<Spool> {
    // First, unassign any spool currently in this tray
    const currentSpools = await this.getSpoolsByTray(trayId);
    for (const spool of currentSpools) {
      if (spool.id !== spoolId) {
        await this.unassignSpoolFromTray(spool.id);
      }
    }

    // Get current spool to preserve other extra fields (like tag)
    // Spoolman's PATCH replaces the entire extra object
    const spool = await this.getSpool(spoolId);
    const newExtra: Record<string, string> = {};
    if (spool.extra) {
      for (const [key, value] of Object.entries(spool.extra)) {
        newExtra[key] = value;
      }
    }
    newExtra['active_tray'] = JSON.stringify(trayId);

    // Assign the new spool
    return this.fetch(`/spool/${spoolId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        extra: newExtra,
      }),
    });
  }

  /**
   * Unassign a spool from its current tray
   */
  async unassignSpoolFromTray(spoolId: number): Promise<Spool> {
    // Get current spool to preserve other extra fields
    const spool = await this.getSpool(spoolId);

    // Build new extra object with active_tray set to empty string
    // Spoolman's PATCH replaces the entire extra object, so we need to include
    // all fields we want to keep. Setting active_tray to "" clears the assignment.
    const newExtra: Record<string, string> = {};
    if (spool.extra) {
      for (const [key, value] of Object.entries(spool.extra)) {
        if (key !== 'active_tray') {
          newExtra[key] = value;
        }
      }
    }
    // Set active_tray to JSON-encoded empty string to clear it
    // Spoolman requires extra field values to be valid JSON
    newExtra['active_tray'] = JSON.stringify('');

    // Send the updated extra object with empty active_tray
    return this.fetch<Spool>(`/spool/${spoolId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        extra: newExtra,
      }),
    });
  }

  /**
   * Store a Bambu RFID tag UID on a spool
   * Supports multiple tags (comma-separated) to handle Bambu firmware bug where
   * the same spool reports different tag_uids based on tray position.
   * Also clears the tag from any other spools that have it (since each RFID is unique)
   */
  async setSpoolTag(spoolId: number, tagUid: string): Promise<Spool> {
    // First, clear this tag from any other spools that have it
    await this.clearDuplicateTags(tagUid, spoolId);

    // Get current spool to preserve other extra fields
    const spool = await this.getSpool(spoolId);

    // Build new extra object
    const newExtra: Record<string, string> = {};
    if (spool.extra) {
      for (const [key, value] of Object.entries(spool.extra)) {
        newExtra[key] = value;
      }
    }

    // Get existing tags and add new one if not already present
    const existingTagsRaw = spool.extra?.['tag'];
    let existingTags: string[] = [];
    if (existingTagsRaw) {
      try {
        const parsed = JSON.parse(existingTagsRaw);
        if (parsed && parsed !== '') {
          // Split by comma to get array of tags
          existingTags = parsed.split(',').map((t: string) => t.trim()).filter((t: string) => t !== '');
        }
      } catch {
        // If parsing fails, treat as empty
      }
    }

    // Only add if not already present
    if (!existingTags.includes(tagUid)) {
      existingTags.push(tagUid);
    }

    // Store as comma-separated string
    newExtra['tag'] = JSON.stringify(existingTags.join(','));

    return this.fetch<Spool>(`/spool/${spoolId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        extra: newExtra,
      }),
    });
  }

  /**
   * Clear a tag from all spools except the specified one
   * Used to ensure RFID tags are unique across spools
   * Handles comma-separated tags - removes only the matching tag from the list
   */
  async clearDuplicateTags(tagUid: string, exceptSpoolId: number): Promise<void> {
    const spools = await this.getSpools();

    for (const spool of spools) {
      if (spool.id === exceptSpoolId) continue;

      const existingTagsRaw = spool.extra?.['tag'];
      if (!existingTagsRaw) continue;

      let existingTags: string[] = [];
      try {
        const parsed = JSON.parse(existingTagsRaw);
        if (parsed && parsed !== '') {
          existingTags = parsed.split(',').map((t: string) => t.trim()).filter((t: string) => t !== '');
        }
      } catch {
        continue;
      }

      // Check if this spool has the tag we're looking for
      if (existingTags.includes(tagUid)) {
        // Remove only this specific tag from the list
        const updatedTags = existingTags.filter(t => t !== tagUid);

        // Build new extra object
        const newExtra: Record<string, string> = {};
        if (spool.extra) {
          for (const [key, value] of Object.entries(spool.extra)) {
            if (key !== 'tag') {
              newExtra[key] = value;
            }
          }
        }
        newExtra['tag'] = JSON.stringify(updatedTags.length > 0 ? updatedTags.join(',') : '');

        await this.fetch<Spool>(`/spool/${spool.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            extra: newExtra,
          }),
        });
      }
    }
  }

  /**
   * Find a spool by its RFID tag
   * Supports comma-separated tags - returns spool if ANY stored tag matches
   */
  async findSpoolByTag(tagUid: string): Promise<Spool | null> {
    const spools = await this.getSpools();

    for (const spool of spools) {
      const existingTagsRaw = spool.extra?.['tag'];
      if (!existingTagsRaw) continue;

      try {
        const parsed = JSON.parse(existingTagsRaw);
        if (parsed && parsed !== '') {
          const existingTags = parsed.split(',').map((t: string) => t.trim()).filter((t: string) => t !== '');
          if (existingTags.includes(tagUid)) {
            return spool;
          }
        }
      } catch {
        // If parsing fails, skip this spool
      }
    }

    return null;
  }

  /**
   * Update spool weight (use filament)
   */
  async useWeight(spoolId: number, weight: number): Promise<void> {
    await this.fetch(`/spool/${spoolId}/use`, {
      method: 'PUT',
      body: JSON.stringify({ use_weight: weight }),
    });
  }

  /**
   * Get all vendors
   */
  async getVendors(): Promise<Vendor[]> {
    return this.fetch('/vendor');
  }

  /**
   * Get all filaments
   */
  async getFilaments(): Promise<Filament[]> {
    return this.fetch('/filament');
  }

  /**
   * Get all extra fields for spools
   */
  async getSpoolExtraFields(): Promise<ExtraField[]> {
    return this.fetch('/field/spool');
  }

  /**
   * Create or update an extra field for spools
   */
  async createSpoolExtraField(key: string, name: string, fieldType: string = 'text'): Promise<ExtraField[]> {
    return this.fetch(`/field/spool/${key}`, {
      method: 'POST',
      body: JSON.stringify({
        name,
        field_type: fieldType,
      }),
    });
  }

  /**
   * Ensure all required extra fields exist in Spoolman
   * This is required for SpoolmanSync to track tray assignments and barcode scanning
   */
  async ensureRequiredFieldsExist(): Promise<void> {
    const requiredFields = [
      { key: 'active_tray', name: 'active_tray', description: 'tray assignments' },
      { key: 'barcode', name: 'barcode', description: 'barcode/QR code scanning' },
      { key: 'tag', name: 'tag', description: 'Bambu RFID tag UID for auto-matching' },
    ];

    try {
      const existingFields = await this.getSpoolExtraFields();
      const existingKeys = new Set(existingFields.map(f => f.key));

      for (const field of requiredFields) {
        if (!existingKeys.has(field.key)) {
          await this.createSpoolExtraField(field.key, field.name, 'text');
        }
      }
    } catch (error) {
      console.error('[SpoolmanSync] Failed to ensure required fields exist:', error);
      throw new Error('Failed to configure Spoolman extra fields. Please ensure Spoolman is accessible and try again.');
    }
  }
}
