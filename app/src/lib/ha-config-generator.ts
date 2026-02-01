/**
 * Home Assistant Configuration Generator for SpoolmanSync
 *
 * Generates automations.yaml and configuration.yaml additions
 * for automatic spool tracking with Bambu Lab printers.
 *
 * Supports multiple AMS units per printer.
 */

import { HAPrinter } from './api/homeassistant';
import { extractPrinterPrefix } from './entity-patterns';

export interface GeneratedConfig {
  automationsYaml: string;
  configurationAdditions: string;
  printerCount: number;
  trayCount: number;
}

/**
 * Tray info extracted from printer discovery
 */
interface TrayInfo {
  entityId: string;
  amsNumber: number;  // 0 for external spool, 1+ for AMS units
  trayNumber: number; // 0 for external, 1-4 for AMS trays
  compositeId: number; // Encoded as amsNumber * 10 + trayNumber (0 for external, 11-14 for AMS1, 21-24 for AMS2, etc.)
}

/**
 * Generate complete HA configuration for SpoolmanSync
 */
export function generateHAConfig(
  printers: HAPrinter[],
  webhookUrl: string,
  spoolmanUrl: string
): GeneratedConfig {
  if (printers.length === 0) {
    return {
      automationsYaml: '[]',
      configurationAdditions: '',
      printerCount: 0,
      trayCount: 0,
    };
  }

  // For now, use the first printer (most users have one)
  // TODO: Support multiple printers
  const printer = printers[0];
  const prefix = extractPrinterPrefix(printer.entity_id);

  // Use discovered entity IDs for automation generation
  // This handles localized entity names automatically since we discover the actual IDs from HA
  // If entities aren't found, log warnings - don't fall back to guessing names
  const missingEntities: string[] = [];

  if (!printer.current_stage_entity) {
    missingEntities.push('current_stage');
    console.warn(`[SpoolmanSync] Could not find current_stage entity for printer ${prefix}. Automation triggers may not work.`);
  }
  if (!printer.print_weight_entity) {
    missingEntities.push('print_weight');
    console.warn(`[SpoolmanSync] Could not find print_weight entity for printer ${prefix}. Filament usage tracking may not work.`);
  }
  if (!printer.print_progress_entity) {
    missingEntities.push('print_progress');
    console.warn(`[SpoolmanSync] Could not find print_progress entity for printer ${prefix}. Filament usage tracking may not work.`);
  }

  if (missingEntities.length > 0) {
    console.warn(`[SpoolmanSync] Missing entities: ${missingEntities.join(', ')}. Your Home Assistant may be using a language not yet supported. Please report your entity names at https://github.com/gibz104/SpoolmanSync/issues`);
  }

  const discoveredEntities: LocalizedEntities = {
    current_stage: printer.current_stage_entity || '',
    print_weight: printer.print_weight_entity || '',
    print_progress: printer.print_progress_entity || '',
    external_spool: printer.external_spool?.entity_id || '',
  };

  // Collect all trays from all AMS units
  const allTrays: TrayInfo[] = [];

  // Add external spool first (composite ID = 0)
  if (printer.external_spool) {
    allTrays.push({
      entityId: printer.external_spool.entity_id,
      amsNumber: 0,
      trayNumber: 0,
      compositeId: 0,
    });
  }

  // Add trays from all AMS units
  for (const ams of printer.ams_units) {
    // Extract AMS number from entity_id (e.g., sensor.xxx_ams_2_humidity -> 2)
    const amsMatch = ams.entity_id.match(/_ams_(\d+)_/);
    const amsNumber = amsMatch ? parseInt(amsMatch[1], 10) : 1;

    for (const tray of ams.trays) {
      allTrays.push({
        entityId: tray.entity_id,
        amsNumber,
        trayNumber: tray.tray_number,
        compositeId: amsNumber * 10 + tray.tray_number, // e.g., AMS2 tray 3 = 23
      });
    }
  }

  const trayCount = allTrays.length;

  // Generate the comprehensive automation
  const automationsYaml = generateAutomationsYaml(prefix, allTrays, webhookUrl, discoveredEntities);

  // Generate configuration additions
  const configurationAdditions = generateConfigurationAdditions(prefix, allTrays, spoolmanUrl, discoveredEntities);

  return {
    automationsYaml,
    configurationAdditions,
    printerCount: printers.length,
    trayCount,
  };
}

/**
 * Build Jinja2 template to find active tray entity ID from composite tray number
 * Returns the full entity ID based on the composite number
 */
function buildTrayEntityLookup(allTrays: TrayInfo[]): string {
  // Build a Jinja2 conditional that maps composite ID to entity ID
  const conditions: string[] = [];

  for (const tray of allTrays) {
    conditions.push(`{% if tray_composite == ${tray.compositeId} %}${tray.entityId}{% endif %}`);
  }

  // Join with elif logic - but since Jinja doesn't have elif in this form, we use nested ifs
  // Actually, we can output all and only one will match
  return conditions.join('');
}

/**
 * Localized entity names type
 */
interface LocalizedEntities {
  current_stage: string;
  print_weight: string;
  print_progress: string;
  external_spool: string;
}

/**
 * Generate automations.yaml content
 * Supports multiple AMS units
 */
function generateAutomationsYaml(
  prefix: string,
  allTrays: TrayInfo[],
  webhookUrl: string,
  entities: LocalizedEntities
): string {
  // Build list of all tray entity IDs for triggers
  const trayEntityIds = allTrays.map(t => t.entityId);

  // Build the tray_sensor lookup template
  const trayEntityLookup = buildTrayEntityLookup(allTrays);

  return `# =============================================================================
# SpoolmanSync Automation: Track Spool Usage
#
# Auto-generated by SpoolmanSync for printer: ${prefix}
# Supports ${allTrays.length} tray(s) across ${new Set(allTrays.map(t => t.amsNumber)).size} AMS unit(s)
#
# This automation tracks:
# 1. Tray changes - when the AMS switches to a different tray (or external spool)
# 2. Print completion - to log final filament usage
#
# Tray encoding: composite_id = ams_number * 10 + tray_number
# - 0 = external spool
# - 11-14 = AMS1 trays 1-4
# - 21-24 = AMS2 trays 1-4
# - etc.
# =============================================================================
- id: 'spoolmansync_update_spool_${prefix}'
  alias: SpoolmanSync - Update Spool
  description: Track spool usage and sync with Spoolman
  triggers:
    - entity_id: sensor.spoolmansync_${prefix}_active_tray
      id: tray
      trigger: state
    - entity_id: ${entities.current_stage}
      to:
        - finished
        - idle
      id: print_end
      trigger: state
  variables:
    # For tray trigger: get the old tray composite ID (what we're switching FROM)
    old_tray: |-
      {% if trigger.id == 'tray' and trigger.from_state.state not in [None, '', 'unknown', 'unavailable'] %}
        {{ trigger.from_state.state | int(-1) }}
      {% else %}
        -1
      {% endif %}
    # For tray trigger: get the new tray composite ID (what we're switching TO)
    new_tray: |-
      {% if trigger.id == 'tray' and trigger.to_state.state not in [None, '', 'unknown', 'unavailable'] %}
        {{ trigger.to_state.state | int(-1) }}
      {% else %}
        -1
      {% endif %}
    # For print_end: use the helper
    tray_composite: |-
      {% if trigger.id == 'print_end' %}
        {{ states('input_number.spoolmansync_last_tray') | int(-1) }}
      {% else %}
        {{ old_tray }}
      {% endif %}
    # Build sensor entity ID for the tray we're logging
    tray_sensor: "${trayEntityLookup}"
    tray_weight: "{{ states('sensor.spoolmansync_filament_usage_meter') | float(0) | round(2) }}"
    tray_uuid: "{{ state_attr(tray_sensor, 'tray_uuid') | default('') }}"
    material: "{{ state_attr(tray_sensor, 'type') | default('') }}"
    name: "{{ state_attr(tray_sensor, 'name') | default('') }}"
    color: "{{ state_attr(tray_sensor, 'color') | default('') }}"
  actions:
    - choose:
        # =====================================================================
        # TRAY CHANGE - Log old tray usage (if valid), ALWAYS update helper
        # =====================================================================
        - conditions:
            - condition: template
              value_template: "{{ trigger.id == 'tray' }}"
          sequence:
            # Log usage from OLD tray if:
            # 1. old_tray was valid (>= 0)
            # 2. we have weight to log (>= 0.01g)
            # 3. tray_sensor resolved to a valid entity (defense-in-depth)
            # Note: We don't check current stage because accumulated weight on the
            # utility meter represents real filament consumption that should be logged.
            # This handles cancelled prints where the user unloads filament while idle.
            - choose:
                - conditions:
                    - condition: template
                      value_template: "{{ old_tray >= 0 and tray_weight >= 0.01 and tray_sensor != '' }}"
                  sequence:
                    - action: system_log.write
                      data:
                        message: >-
                          SPOOLMANSYNC TRAY CHANGE | Old tray {{ old_tray }} -> New tray {{ new_tray }} |
                          Sensor: {{ tray_sensor }} |
                          Spool: {{ name }} ({{ material }}) |
                          Weight used: {{ tray_weight }}g |
                          Spool Serial: {{ tray_uuid }}
                        level: info
                    - action: rest_command.spoolmansync_update_spool
                      data:
                        filament_name: "{{ name }}"
                        filament_material: "{{ material }}"
                        filament_tray_uuid: "{{ tray_uuid }}"
                        filament_used_weight: "{{ tray_weight }}"
                        filament_color: "{{ color }}"
                        filament_active_tray_id: "{{ tray_sensor }}"
                    - action: utility_meter.calibrate
                      target:
                        entity_id: sensor.spoolmansync_filament_usage_meter
                      data:
                        value: "0"
              default:
                - action: system_log.write
                  data:
                    message: >-
                      SPOOLMANSYNC TRAY CHANGE (no usage logged) | Old: {{ old_tray }} -> New: {{ new_tray }} |
                      Weight: {{ tray_weight }}g |
                      Reason: {{ 'old_tray invalid' if old_tray < 0 else 'no weight to log' }}
                    level: debug
                # Reset meter anyway to prevent stale values from accumulating
                - action: utility_meter.calibrate
                  target:
                    entity_id: sensor.spoolmansync_filament_usage_meter
                  data:
                    value: "0"
            # ALWAYS update helper to new tray composite ID
            - condition: template
              value_template: "{{ new_tray >= 0 }}"
            - action: input_number.set_value
              target:
                entity_id: input_number.spoolmansync_last_tray
              data:
                value: "{{ new_tray }}"
            - action: system_log.write
              data:
                message: "SPOOLMANSYNC HELPER UPDATED | input_number.spoolmansync_last_tray -> {{ new_tray }}"
                level: info

        # =====================================================================
        # PRINT END - Log final tray usage from helper
        # =====================================================================
        - conditions:
            - condition: template
              value_template: >-
                {{ trigger.id == 'print_end'
                   and trigger.from_state.state not in ['unavailable', 'unknown', 'idle', 'finished'] }}
          sequence:
            - choose:
                - conditions:
                    - condition: template
                      value_template: "{{ tray_composite >= 0 and tray_weight >= 0.01 and tray_sensor != '' }}"
                  sequence:
                    - action: system_log.write
                      data:
                        message: >-
                          SPOOLMANSYNC PRINT END | Tray {{ tray_composite }} |
                          Sensor: {{ tray_sensor }} |
                          Spool: {{ name }} ({{ material }}) |
                          Weight used: {{ tray_weight }}g |
                          Spool Serial: {{ tray_uuid }}
                        level: info
                    - action: rest_command.spoolmansync_update_spool
                      data:
                        filament_name: "{{ name }}"
                        filament_material: "{{ material }}"
                        filament_tray_uuid: "{{ tray_uuid }}"
                        filament_used_weight: "{{ tray_weight }}"
                        filament_color: "{{ color }}"
                        filament_active_tray_id: "{{ tray_sensor }}"
              default:
                - action: system_log.write
                  data:
                    message: >-
                      SPOOLMANSYNC PRINT END (skipped) | Tray: {{ tray_composite }} | Weight: {{ tray_weight }}g |
                      Reason: {{ 'no tray in helper' if tray_composite < 0 else 'no weight' }}
                    level: warning
            # Always reset meter after print
            - action: utility_meter.calibrate
              target:
                entity_id: sensor.spoolmansync_filament_usage_meter
              data:
                value: "0"
            - action: system_log.write
              data:
                message: "SPOOLMANSYNC METER RESET after print end"
                level: info
  mode: single

# =============================================================================
# SpoolmanSync Automation: Tray Change Detection
#
# Detects physical spool changes (insert/remove) and syncs with Spoolman.
# Triggers when any AMS tray or external spool sensor changes state.
# =============================================================================
- id: 'spoolmansync_tray_change_${prefix}'
  alias: SpoolmanSync - Tray Change
  description: Detect physical spool changes and auto-assign/unassign in Spoolman
  triggers:
    # Trigger on any state or attribute change for tray sensors
    - entity_id:
${trayEntityIds.map(id => `        - ${id}`).join('\n')}
      trigger: state
  conditions:
    # Only trigger if the entity is actually available
    - condition: template
      value_template: "{{ trigger.to_state.state not in ['unavailable', 'unknown'] }}"
    # Debounce: only trigger if tray_uuid or name actually changed between old and new state
    - condition: template
      value_template: >-
        {{ trigger.from_state is none or
           trigger.to_state.attributes.get('tray_uuid', '') != trigger.from_state.attributes.get('tray_uuid', '') or
           trigger.to_state.attributes.get('name', '') != trigger.from_state.attributes.get('name', '') }}
  variables:
    tray_entity_id: "{{ trigger.entity_id }}"
    tray_uuid: "{{ state_attr(trigger.entity_id, 'tray_uuid') | default('') }}"
    name: "{{ state_attr(trigger.entity_id, 'name') | default('') }}"
    material: "{{ state_attr(trigger.entity_id, 'type') | default('') }}"
    color: "{{ state_attr(trigger.entity_id, 'color') | default('') }}"
  actions:
    - action: system_log.write
      data:
        message: >-
          SPOOLMANSYNC TRAY CHANGE DETECTED | {{ tray_entity_id }} |
          Name: {{ name }} | Material: {{ material }} |
          Spool Serial: {{ tray_uuid }} | Color: {{ color }}
        level: info
    - action: rest_command.spoolmansync_tray_change
      data:
        tray_entity_id: "{{ tray_entity_id }}"
        tray_uuid: "{{ tray_uuid }}"
        name: "{{ name }}"
        material: "{{ material }}"
        color: "{{ color }}"
  mode: queued
  max: 10
`;
}

/**
 * Build Jinja2 template to detect active tray from all AMS units
 * Returns composite ID: 0 = external, 11-14 = AMS1, 21-24 = AMS2, etc.
 */
function buildActiveTrayDetection(allTrays: TrayInfo[]): string {
  const checks: string[] = [];

  // First check external spool if present
  const externalTray = allTrays.find(t => t.compositeId === 0);
  if (externalTray) {
    // External spool needs extra check - ignore if name is "Empty" to prevent false positives
    checks.push(`
          {# Check external spool (composite ID = 0) - only if it has configured filament #}
          {% set ext_name = state_attr('${externalTray.entityId}', 'name') | default('') | string | lower | trim %}
          {% if state_attr('${externalTray.entityId}', 'active') in [true, 'true', 'True']
             and ext_name not in ['empty', '', 'unknown'] %}
            0
          {% endif %}`);
  }

  // Check each AMS tray explicitly using discovered entity IDs
  // This ensures correct entity IDs including any suffixes (_2, _3, etc.)
  const amsTrays = allTrays.filter(t => t.amsNumber > 0).sort((a, b) => a.compositeId - b.compositeId);

  if (amsTrays.length > 0) {
    // Group by AMS number for comments
    const amsNumbers = [...new Set(amsTrays.map(t => t.amsNumber))].sort();

    for (const amsNumber of amsNumbers) {
      const traysForAms = amsTrays.filter(t => t.amsNumber === amsNumber);
      checks.push(`
          {# Check AMS${amsNumber} trays #}`);

      for (const tray of traysForAms) {
        checks.push(`
          {% if state_attr('${tray.entityId}', 'active') in [true, 'true', 'True'] %}
            ${tray.compositeId}
          {% endif %}`);
      }
    }
  }

  return checks.join('');
}

/**
 * Generate configuration.yaml additions
 * Supports multiple AMS units
 */
function generateConfigurationAdditions(
  prefix: string,
  allTrays: TrayInfo[],
  spoolmanUrl: string,
  entities: LocalizedEntities
): string {
  // Build the active tray detection logic
  const activeTrayDetection = buildActiveTrayDetection(allTrays);

  // Build availability check including all tray entities
  const availabilityEntities = allTrays.map(t => `'${t.entityId}'`);

  // Calculate max value for input_number (needs to accommodate highest composite ID)
  const maxCompositeId = Math.max(...allTrays.map(t => t.compositeId), 99);

  return `
# =============================================================================
# SpoolmanSync Configuration
# Auto-generated for printer: ${prefix}
# Supports ${allTrays.length} tray(s) across ${new Set(allTrays.map(t => t.amsNumber)).size} AMS unit(s)
#
# Tray encoding: composite_id = ams_number * 10 + tray_number
# - 0 = external spool
# - 11-14 = AMS1 trays 1-4
# - 21-24 = AMS2 trays 1-4
# - etc.
# =============================================================================

# Helper to track last active tray (captures tray when it changes)
# Stores composite ID encoding AMS number and tray number
input_number:
  spoolmansync_last_tray:
    name: "SpoolmanSync Last Tray"
    min: 0
    max: ${maxCompositeId}
    step: 1

# Utility meter to track filament usage between updates
utility_meter:
  spoolmansync_filament_usage_meter:
    unique_id: spoolmansync-filament-usage-meter
    source: sensor.spoolmansync_filament_usage
    cycle: weekly

# REST commands to send updates to SpoolmanSync webhook
rest_command:
  spoolmansync_update_spool:
    url: "${spoolmanUrl}"
    method: POST
    headers:
      Content-Type: "application/json"
    payload: >
      {
        "event": "spool_usage",
        "name": "{{ filament_name }}",
        "material": "{{ filament_material }}",
        "tray_uuid": "{{ filament_tray_uuid }}",
        "used_weight": {{ filament_used_weight | round(2) }},
        "color": "{{ filament_color }}",
        "active_tray_id": "{{ filament_active_tray_id }}"
      }

  spoolmansync_tray_change:
    url: "${spoolmanUrl}"
    method: POST
    headers:
      Content-Type: "application/json"
    payload: >
      {
        "event": "tray_change",
        "tray_entity_id": "{{ tray_entity_id }}",
        "tray_uuid": "{{ tray_uuid }}",
        "name": "{{ name }}",
        "material": "{{ material }}",
        "color": "{{ color }}"
      }

# Template sensors for filament tracking
template:
  - sensor:
      # Calculate filament usage during print
      - name: "SpoolmanSync Filament Usage"
        unique_id: spoolmansync-filament-usage
        state: >
          {{ states('${entities.print_weight}') | float(0) / 100 *
             states('${entities.print_progress}') | float(0) }}
        availability: >
          {{ states('${entities.print_weight}') not in ['unknown', 'unavailable'] }}

      # Detect active tray from all AMS tray sensors and external spool
      # Returns composite ID: 0 = external, 11-14 = AMS1, 21-24 = AMS2, etc.
      - name: "SpoolmanSync ${prefix} Active Tray"
        unique_id: spoolmansync-${prefix}-active-tray
        state: >${activeTrayDetection}
        availability: >
          {{ expand([
            ${availabilityEntities.join(',\n            ')}
          ]) | selectattr('attributes.active','defined') | list | count > 0 }}
`;
}

/**
 * Merge configuration additions into existing configuration.yaml content
 */
export function mergeConfiguration(existingConfig: string, additions: string): string {
  // Check if SpoolmanSync config already exists
  if (existingConfig.includes('# SpoolmanSync Configuration')) {
    // Remove existing SpoolmanSync section and add new one
    const spoolmanSyncStart = existingConfig.indexOf('# =============================================================================\n# SpoolmanSync Configuration');
    if (spoolmanSyncStart !== -1) {
      // Find the end of the SpoolmanSync section (next major section or end of file)
      let spoolmanSyncEnd = existingConfig.length;
      const nextSection = existingConfig.indexOf('\n# ===', spoolmanSyncStart + 10);
      if (nextSection !== -1 && !existingConfig.substring(spoolmanSyncStart, nextSection).includes('SpoolmanSync')) {
        spoolmanSyncEnd = nextSection;
      }
      existingConfig = existingConfig.substring(0, spoolmanSyncStart) + existingConfig.substring(spoolmanSyncEnd);
    }
  }

  // Append the new configuration
  return existingConfig.trim() + '\n' + additions;
}
