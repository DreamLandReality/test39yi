/**
 * Manifest Loader
 *
 * Central utility to read section data, theme, and configuration
 * from template.manifest.json. This replaces the old pattern of
 * importing individual data/*.json files.
 *
 * Usage:
 *   import { getSectionData, isSectionEnabled, getTheme } from '@/lib/manifest-loader';
 *   const heroData = getSectionData('hero');
 *   const theme = getTheme();
 */

// @ts-ignore - JSON import handled by Astro/Vite
import manifest from '../../template.manifest.json';

interface ManifestSection {
    id: string;
    enabled?: boolean;
    dataType?: 'object' | 'array';
    data?: any;
    schema?: any;
    [key: string]: any;
}

interface CollectionItem {
    id: string;
    [key: string]: any;
}

interface ManifestCollection {
    id: string;
    name: string;
    slug: string;
    schema?: any;
    data: CollectionItem[];
}

interface ThemeConfig {
    colors: {
        primary: string;
        primaryForeground: string;
        background: string;
        surface: string;
        muted: string;
        border: string;
    };
    typography: {
        fontSans: string;
        fontSerif: string;
    };
    radius: {
        base: string;
    };
}

// Build a lookup map of sections by id
const sectionsMap = new Map<string, ManifestSection>(
    (manifest as any).sections.map((s: ManifestSection) => [s.id, s])
);

// Build a lookup map of collections by id + a flat item index by item id
const collections: ManifestCollection[] = (manifest as any).collections ?? [];
const collectionsMap = new Map<string, ManifestCollection>(
    collections.map((c) => [c.id, c])
);
const collectionItemIndex = new Map<string, CollectionItem>();
for (const col of collections) {
    for (const item of col.data) {
        collectionItemIndex.set(item.id, item);
    }
}

/**
 * Get section data by ID.
 * Returns the defaultData for the section, or an empty object/array.
 */
export function getSectionData<T = Record<string, any>>(sectionId: string): T {
    const section = sectionsMap.get(sectionId);
    if (!section) {
        console.warn(`[manifest-loader] Section "${sectionId}" not found`);
        return {} as T;
    }
    const data = section.data ?? {};
    if (typeof data !== 'object' || !section.schema?.properties) return data as T;

    // Resolve collection references: replace string ID arrays with full objects
    const resolved = { ...data };
    for (const [key, fieldSchema] of Object.entries(section.schema.properties) as [string, any][]) {
        if (fieldSchema.uiWidget === 'collectionPicker' && Array.isArray(resolved[key])) {
            const refs = resolved[key];
            if (refs.length > 0 && typeof refs[0] === 'string') {
                resolved[key] = refs
                    .map((id: string) => collectionItemIndex.get(id))
                    .filter((item: any): item is CollectionItem => !!item);
            }
        }
    }
    return resolved as T;
}

/**
 * Get collection data by collection ID.
 * Returns the full array of collection items.
 */
export function getCollectionData<T = CollectionItem[]>(collectionId: string): T {
    const col = collectionsMap.get(collectionId);
    if (!col) {
        console.warn(`[manifest-loader] Collection "${collectionId}" not found`);
        return [] as T;
    }
    return col.data as T;
}

/**
 * Check if a section is enabled.
 * Defaults to true if the enabled flag is not set.
 */
export function isSectionEnabled(sectionId: string): boolean {
    const section = sectionsMap.get(sectionId);
    return section?.enabled !== false;
}

/**
 * Get the theme configuration with actual values.
 * Checks the theme section in sections[] first (admin-editable),
 * then falls back to manifest.theme for backwards compatibility.
 */
export function getTheme(): ThemeConfig {
    // Prefer the theme section (admin panel edits flow through here)
    const themeSection = sectionsMap.get('theme');
    if (themeSection?.data) {
        return themeSection.data as ThemeConfig;
    }

    // Legacy: read from manifest.theme top-level key
    const theme = (manifest as any).theme;
    if (!theme) {
        return {
            colors: { primary: '#e8ddd0', primaryForeground: '#0c0b09', background: '#0c0b09', surface: '#161410', muted: '#7a7060', border: '#2a2620' },
            typography: { fontSans: "'Montserrat', sans-serif", fontSerif: "'Cormorant Garamond', serif" },
            radius: { base: '0px' }
        };
    }

    if (theme.data) {
        return theme.data as ThemeConfig;
    }

    // Extract defaults from schema-style definitions
    const extractDefaults = (obj: Record<string, any>): Record<string, any> => {
        const result: Record<string, any> = {};
        for (const [key, value] of Object.entries(obj)) {
            if (value && typeof value === 'object' && 'default' in value) {
                result[key] = value.default;
            } else if (value && typeof value === 'object' && !('type' in value)) {
                result[key] = extractDefaults(value);
            }
        }
        return result;
    };

    return extractDefaults(theme) as ThemeConfig;
}

/**
 * Generate a CSS string from the styleOverrides block in the manifest.
 *
 * styleOverrides is structured as:
 *   { sectionId: { fieldName: { cssProp: value } } }
 * where value is either a flat string ("0.5em") or a responsive object
 * { mobile: "3rem", tablet: "4rem", desktop: "7rem" }.
 *
 * Returns a single CSS string ready to inject into a <style> tag.
 * Responsive values produce media-query rules:
 *   Mobile:  base rule (no query)
 *   Tablet:  @media (min-width: 768px) and (max-width: 1199px)
 *   Desktop: @media (min-width: 1200px)
 */
export function getStyleOverridesCSS(): string {
    const overrides = (manifest as any).styleOverrides as
        Record<string, Record<string, Record<string, unknown>>> | undefined;
    if (!overrides) return '';

    const rules: string[] = [];

    for (const [sectionId, fields] of Object.entries(overrides)) {
        for (const [field, props] of Object.entries(fields)) {
            const selector = field === '__section'
                ? `[data-dr-section="${sectionId}"]`
                : `[data-dr-section="${sectionId}"] [data-dr-style="${field}"]`;

            for (const [cssProp, value] of Object.entries(props)) {
                const kebab = cssProp.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
                const isResponsive = typeof value === 'object' && value !== null
                    && ('mobile' in value || 'tablet' in value || 'desktop' in value);

                if (isResponsive) {
                    const rv = value as { mobile?: string; tablet?: string; desktop?: string };
                    if (rv.mobile) {
                        rules.push(`${selector} { ${kebab}: ${rv.mobile}; }`);
                    }
                    if (rv.tablet) {
                        rules.push(`@media (min-width: 768px) and (max-width: 1199px) { ${selector} { ${kebab}: ${rv.tablet}; } }`);
                    }
                    if (rv.desktop) {
                        rules.push(`@media (min-width: 1200px) { ${selector} { ${kebab}: ${rv.desktop}; } }`);
                    }
                } else if (typeof value === 'string' && value) {
                    rules.push(`${selector} { ${kebab}: ${value}; }`);
                }
            }
        }
    }

    return rules.join('\n');
}

/**
 * Get all sections (for iteration/enumeration).
 */
export function getAllSections(): ManifestSection[] {
    return (manifest as any).sections;
}

/**
 * Get the raw manifest object.
 */
export function getManifest() {
    return manifest;
}
