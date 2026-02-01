/**
 * Centralized entity name patterns for ha-bambulab integration
 *
 * ha-bambulab localizes entity IDs based on Home Assistant's language setting.
 * Add new language patterns here - they will automatically be used throughout the app.
 */

// Localized suffixes for the print_status sensor (used to identify printers)
export const PRINT_STATUS_SUFFIXES = [
  'print_status',           // English
  'druckstatus',            // German
  'printstatus',            // Dutch
  'estado_de_la_impresion', // Spanish
  'stato_di_stampa',        // Italian
  // Add more languages here:
];

// Localized names for AMS humidity sensor
export const AMS_HUMIDITY_NAMES = [
  'humidity',          // English
  'luftfeuchtigkeit',  // German
  'vochtigheid',       // Dutch
  'humedad',           // Spanish
  'umidita',           // Italian
  // Add more languages here:
];

// Localized names for AMS tray sensor
export const TRAY_NAMES = [
  'tray',              // English (also used in Dutch)
  'slot',              // German, Italian
  'bandeja',           // Spanish
  // Add more languages here:
];

// Localized names for external spool sensor
export const EXTERNAL_SPOOL_NAMES = [
  'external_spool',                   // English
  'externalspool_external_spool',     // English newer ha-bambulab format
  'externe_spule',                    // German
  'externespule_externe_spule',       // German newer format
  'externe_spoel',                    // Dutch
  'externespoel_externe_spoel',       // Dutch newer format
  'bobina_externa',                   // Spanish
  'bobinaexterna_bobina_externa',     // Spanish newer format
  'bobina_esterna',                   // Italian
  'bobinaesterna_bobina_esterna',     // Italian newer format
  // Add more languages here:
];

// Localized friendly name suffixes to strip from printer names
export const FRIENDLY_NAME_SUFFIXES = [
  'Print Status',           // English
  'Druckstatus',            // German
  'Printstatus',            // Dutch
  'Estado de la Impresión', // Spanish
  'Stato di stampa',        // Italian
  // Add more languages here:
];

// Localized names for current_stage sensor (used in automation triggers)
export const CURRENT_STAGE_NAMES = [
  'current_stage',           // English
  'aktueller_arbeitsschritt', // German
  'huidige_fase',            // Dutch
  'estado_actual',           // Spanish
  'fase_corrente',           // Italian
  // Add more languages here:
];

// Localized names for print_weight sensor
export const PRINT_WEIGHT_NAMES = [
  'print_weight',            // English
  'gewicht_des_drucks',      // German
  'gewicht_van_print',       // Dutch
  'peso_de_la_impresion',    // Spanish
  'grammatura_stampa',       // Italian
  // Add more languages here:
];

// Localized names for print_progress sensor
export const PRINT_PROGRESS_NAMES = [
  'print_progress',          // English
  'druckfortschritt',        // German
  'printvoortgang',          // Dutch
  'progreso_de_la_impresion', // Spanish
  'progressi_di_stampa',     // Italian
  // Add more languages here:
];

// Supported languages for entity localization
export type SupportedLanguage = 'en' | 'de' | 'nl' | 'es' | 'it';

// Mapping of print_status suffix to language code
const PRINT_STATUS_TO_LANGUAGE: Record<string, SupportedLanguage> = {
  'print_status': 'en',
  'druckstatus': 'de',
  'printstatus': 'nl',
  'estado_de_la_impresion': 'es',
  'stato_di_stampa': 'it',
};

// Localized entity names by language
// These are used in the YAML generator for automation triggers
const LOCALIZED_ENTITIES: Record<SupportedLanguage, {
  current_stage: string;
  print_weight: string;
  print_progress: string;
  external_spool: string;
}> = {
  en: {
    current_stage: 'current_stage',
    print_weight: 'print_weight',
    print_progress: 'print_progress',
    external_spool: 'external_spool',
  },
  de: {
    current_stage: 'aktueller_arbeitsschritt',
    print_weight: 'gewicht_des_drucks',
    print_progress: 'druckfortschritt',
    external_spool: 'externe_spule',
  },
  nl: {
    current_stage: 'huidige_fase',
    print_weight: 'gewicht_van_print',
    print_progress: 'printvoortgang',
    external_spool: 'externe_spoel',
  },
  es: {
    current_stage: 'estado_actual',
    print_weight: 'peso_de_la_impresion',
    print_progress: 'progreso_de_la_impresion',
    external_spool: 'bobina_externa',
  },
  it: {
    current_stage: 'fase_corrente',
    print_weight: 'grammatura_stampa',
    print_progress: 'progressi_di_stampa',
    external_spool: 'bobina_esterna',
  },
};

/**
 * Build a regex pattern that matches any of the print status suffixes
 * Includes optional version suffix (_2, _3, etc.)
 */
export function buildPrintStatusPattern(): RegExp {
  const suffixes = PRINT_STATUS_SUFFIXES.join('|');
  return new RegExp(`^sensor\\.(.+?)_(?:${suffixes})(?:_\\d+)?$`);
}

/**
 * Build a regex pattern for AMS humidity sensors
 * @param prefix - The printer prefix (e.g., "x1c_00m09d462101575")
 */
export function buildAmsPattern(prefix: string): RegExp {
  const names = AMS_HUMIDITY_NAMES.join('|');
  return new RegExp(`^sensor\\.${prefix}_ams_(\\d+)_(?:${names})(?:_(\\d+))?$`);
}

/**
 * Build a regex pattern for AMS tray sensors
 * @param prefix - The printer prefix
 * @param amsNumber - The AMS unit number (1-4)
 * @param trayNum - The tray number (1-4)
 */
export function buildTrayPattern(prefix: string, amsNumber: string, trayNum: number): RegExp {
  const names = TRAY_NAMES.join('|');
  return new RegExp(`^sensor\\.${prefix}_ams_${amsNumber}_(?:${names})_${trayNum}(?:_(\\d+))?$`);
}

/**
 * Build a regex pattern for external spool sensors
 * @param prefix - The printer prefix
 */
export function buildExternalSpoolPattern(prefix: string): RegExp {
  const names = EXTERNAL_SPOOL_NAMES.join('|');
  return new RegExp(`^sensor\\.${prefix}_(${names})(?:_(\\d+))?$`);
}

/**
 * Build a regex pattern for current_stage sensors
 * @param prefix - The printer prefix
 */
export function buildCurrentStagePattern(prefix: string): RegExp {
  const names = CURRENT_STAGE_NAMES.join('|');
  return new RegExp(`^sensor\\.${prefix}_(${names})(?:_(\\d+))?$`);
}

/**
 * Build a regex pattern for print_weight sensors
 * @param prefix - The printer prefix
 */
export function buildPrintWeightPattern(prefix: string): RegExp {
  const names = PRINT_WEIGHT_NAMES.join('|');
  return new RegExp(`^sensor\\.${prefix}_(${names})(?:_(\\d+))?$`);
}

/**
 * Build a regex pattern for print_progress sensors
 * @param prefix - The printer prefix
 */
export function buildPrintProgressPattern(prefix: string): RegExp {
  const names = PRINT_PROGRESS_NAMES.join('|');
  return new RegExp(`^sensor\\.${prefix}_(${names})(?:_(\\d+))?$`);
}

/**
 * Check if an entity ID matches any print status pattern
 */
export function isPrintStatusEntity(entityId: string): boolean {
  if (!entityId.startsWith('sensor.')) return false;
  return PRINT_STATUS_SUFFIXES.some(suffix =>
    entityId.endsWith(`_${suffix}`) ||
    entityId.match(new RegExp(`_${suffix}_\\d+$`))
  );
}

/**
 * Extract printer prefix from a print status entity ID
 * e.g., "sensor.x1c_00m09d462101575_print_status" -> "x1c_00m09d462101575"
 * e.g., "sensor.bambulab_p1s_druckstatus" -> "bambulab_p1s"
 */
export function extractPrinterPrefix(entityId: string): string {
  const match = entityId.match(buildPrintStatusPattern());
  if (match) return match[1];

  // Fallback: strip known patterns
  let result = entityId.replace(/^sensor\./, '');
  for (const suffix of PRINT_STATUS_SUFFIXES) {
    result = result.replace(new RegExp(`_${suffix}(?:_\\d+)?$`), '');
  }
  return result;
}

/**
 * Clean friendly name by removing status suffix
 * e.g., "Bambu Lab P1S Print Status" -> "Bambu Lab P1S"
 */
export function cleanFriendlyName(friendlyName: string | undefined, fallback: string): string {
  if (!friendlyName) return fallback;

  let cleaned = friendlyName;
  for (const suffix of FRIENDLY_NAME_SUFFIXES) {
    cleaned = cleaned.replace(new RegExp(` ${suffix}$`, 'i'), '');
  }
  return cleaned || fallback;
}

/**
 * Detect the language from a printer's print_status entity ID
 * e.g., "sensor.bambulab_p1s_druckstatus" -> "de"
 * Returns 'en' as default if language cannot be detected
 */
export function detectLanguageFromEntity(entityId: string): SupportedLanguage {
  for (const [suffix, lang] of Object.entries(PRINT_STATUS_TO_LANGUAGE)) {
    if (entityId.endsWith(`_${suffix}`) || entityId.match(new RegExp(`_${suffix}_\\d+$`))) {
      return lang;
    }
  }
  return 'en'; // Default to English
}

/**
 * Get localized entity names for a specific language
 * Used by the YAML generator to create automations with correct entity IDs
 */
export function getLocalizedEntities(language: SupportedLanguage) {
  return LOCALIZED_ENTITIES[language];
}

/**
 * Get the localized entity name for a specific entity type based on printer's entity ID
 * @param printerEntityId - The printer's print_status entity ID (used to detect language)
 * @param entityType - The type of entity to get the localized name for
 */
export function getLocalizedEntityName(
  printerEntityId: string,
  entityType: 'current_stage' | 'print_weight' | 'print_progress' | 'external_spool'
): string {
  const language = detectLanguageFromEntity(printerEntityId);
  return LOCALIZED_ENTITIES[language][entityType];
}
