import { ModKind } from '../types';

export const WTT_COMMONLIB_FALLBACK_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1A202C"/>
      <stop offset="50%" stop-color="#12161D"/>
      <stop offset="100%" stop-color="#0A0C0F"/>
    </linearGradient>
    <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#EA580C"/>
      <stop offset="100%" stop-color="#F97316"/>
    </linearGradient>
  </defs>
  <rect width="300" height="300" fill="url(#bg)"/>
  
  <!-- Tactical Grid -->
  <g stroke="#2D3748" stroke-width="0.8" opacity="0.35">
    <line x1="20" y1="20" x2="280" y2="20"/>
    <line x1="20" y1="80" x2="280" y2="80"/>
    <line x1="20" y1="140" x2="280" y2="140"/>
    <line x1="20" y1="200" x2="280" y2="200"/>
    <line x1="20" y1="260" x2="280" y2="260"/>
    <line x1="20" y1="20" x2="20" y2="280"/>
    <line x1="80" y1="20" x2="80" y2="280"/>
    <line x1="140" y1="20" x2="140" y2="280"/>
    <line x1="200" y1="20" x2="200" y2="280"/>
    <line x1="260" y1="20" x2="260" y2="280"/>
  </g>

  <!-- Outer Frame -->
  <rect x="14" y="14" width="272" height="272" rx="14" fill="none" stroke="#EA580C" stroke-width="2.5" opacity="0.9"/>
  <rect x="22" y="22" width="256" height="256" rx="10" fill="none" stroke="#2D3748" stroke-width="1.2"/>

  <!-- Tactical Corner Brackets -->
  <path d="M 30 50 L 30 30 L 50 30" fill="none" stroke="#F97316" stroke-width="3"/>
  <path d="M 270 50 L 270 30 L 250 30" fill="none" stroke="#F97316" stroke-width="3"/>
  <path d="M 30 250 L 30 270 L 50 270" fill="none" stroke="#F97316" stroke-width="3"/>
  <path d="M 270 250 L 270 270 L 250 270" fill="none" stroke="#F97316" stroke-width="3"/>

  <!-- Core Microchip Unit -->
  <rect x="105" y="62" width="90" height="90" rx="12" fill="#181F2A" stroke="#EA580C" stroke-width="2"/>
  <rect x="117" y="74" width="66" height="66" rx="8" fill="#0D1117" stroke="#38BDF8" stroke-width="1.5"/>

  <!-- Pins -->
  <g stroke="#EA580C" stroke-width="2">
    <line x1="88" y1="82" x2="105" y2="82"/>
    <line x1="88" y1="107" x2="105" y2="107"/>
    <line x1="88" y1="132" x2="105" y2="132"/>
    <line x1="195" y1="82" x2="212" y2="82"/>
    <line x1="195" y1="107" x2="212" y2="107"/>
    <line x1="195" y1="132" x2="212" y2="132"/>
    <line x1="125" y1="46" x2="125" y2="62"/>
    <line x1="150" y1="46" x2="150" y2="62"/>
    <line x1="175" y1="46" x2="175" y2="62"/>
    <line x1="125" y1="152" x2="125" y2="168"/>
    <line x1="150" y1="152" x2="150" y2="168"/>
    <line x1="175" y1="152" x2="175" y2="168"/>
  </g>

  <!-- Glowing Diode Core -->
  <circle cx="150" cy="107" r="16" fill="url(#glow)"/>
  <circle cx="150" cy="107" r="7" fill="#FFFFFF"/>

  <!-- WTT Header Typography -->
  <text x="150" y="202" font-family="ui-monospace, monospace, sans-serif" font-weight="900" font-size="28" fill="#FFFFFF" text-anchor="middle" letter-spacing="4">WTT</text>
  <text x="150" y="226" font-family="ui-monospace, monospace, sans-serif" font-weight="700" font-size="13" fill="#EA580C" text-anchor="middle" letter-spacing="3">COMMONLIB</text>

  <!-- Sub-badge -->
  <rect x="70" y="244" width="160" height="15" rx="4" fill="#141B24" stroke="#2D3748" stroke-width="1"/>
  <rect x="74" y="247" width="30" height="9" rx="2" fill="#22C55E"/>
  <text x="158" y="255" font-family="ui-monospace, monospace, sans-serif" font-weight="700" font-size="8.5" fill="#9AA3AF" text-anchor="middle" letter-spacing="1">CORE FRAMEWORK</text>
</svg>
`)}`;

export interface KnownDependencyMeta {
  id: number;
  guid: string;
  name: string;
  author: string;
  kind: ModKind;
  categoryTitle: string;
  thumbnail: string;
  fikaCompatibility: boolean;
  version: string;
  teaser: string;
}

export const KNOWN_DEPENDENCIES: Record<string, KnownDependencyMeta> = {
  'com.wtt.commonlib': {
    id: 2909,
    guid: 'com.wtt.commonlib',
    name: 'WTT - CommonLib',
    author: 'WelcomeToTarkov',
    kind: 'Both',
    categoryTitle: 'Tools',
    thumbnail: WTT_COMMONLIB_FALLBACK_IMAGE,
    fikaCompatibility: true,
    version: '3.0.6',
    teaser: 'Core foundational dependency library for WelcomeToTarkov mods and custom item frameworks.',
  },
  'wtt-commonlib': {
    id: 2909,
    guid: 'com.wtt.commonlib',
    name: 'WTT - CommonLib',
    author: 'WelcomeToTarkov',
    kind: 'Both',
    categoryTitle: 'Tools',
    thumbnail: WTT_COMMONLIB_FALLBACK_IMAGE,
    fikaCompatibility: true,
    version: '3.0.6',
    teaser: 'Core foundational dependency library for WelcomeToTarkov mods and custom item frameworks.',
  },
  'xyz.drakia.bigbrain': {
    id: 790,
    guid: 'xyz.drakia.bigbrain',
    name: 'BigBrain',
    author: 'DrakiaXYZ',
    kind: 'Client',
    categoryTitle: 'Bots',
    thumbnail: 'https://files.sp-mod.com/mods/1063.png',
    fikaCompatibility: true,
    version: '1.1.0',
    teaser: 'Plugin to allow multiple mods to add custom logic to bot brain layers without conflicting.',
  },
  'xyz.drakia.waypoints': {
    id: 792,
    guid: 'xyz.drakia.waypoints',
    name: 'Waypoints - Expanded Bot Patrols',
    author: 'DrakiaXYZ',
    kind: 'Client',
    categoryTitle: 'Bots',
    thumbnail: 'https://files.sp-mod.com/mods/1061.png',
    fikaCompatibility: true,
    version: '1.6.0',
    teaser: 'Expands bot navigation meshes and patrol routes to previously unreachable map areas.',
  },
  'me.sol.sain': {
    id: 791,
    guid: 'me.sol.sain',
    name: 'SAIN - Solarint\'s AI Modifications',
    author: 'Solarint',
    kind: 'Both',
    categoryTitle: 'Bots',
    thumbnail: 'https://files.sp-mod.com/mods/1062.jpg',
    fikaCompatibility: true,
    version: '3.0.5',
    teaser: 'Full AI Combat System Replacement: intelligent peek angles, dynamic suppression, blind fire.',
  },
  'fika.ghostfenixx.svm': {
    id: 802,
    guid: 'fika.ghostfenixx.svm',
    name: 'Server Value Modifier (SVM)',
    author: 'GhostFenixx',
    kind: 'Server',
    categoryTitle: 'Overhauls',
    thumbnail: 'https://files.sp-mod.com/mods/1064.png',
    fikaCompatibility: true,
    version: '1.8.2',
    teaser: 'Ultimate all-in-one SPT config suite to adjust raid times, XP rates, health, weight, and loot.',
  },
  'com.amanda.graphics': {
    id: 592,
    guid: 'com.amanda.graphics',
    name: 'Amands\'s Graphics',
    author: 'Amands95',
    kind: 'Client',
    categoryTitle: 'Retextures',
    thumbnail: 'https://files.sp-mod.com/mods/813.png',
    fikaCompatibility: true,
    version: '2.3.0',
    teaser: 'Lighting, postprocessing overhaul, fog removal, and indoor illumination fix.',
  },
  'com.luna.lunnayalunalotus': {
    id: 3085,
    guid: 'com.luna.lunnayalunalotus',
    name: 'Lotus',
    author: 'LotusLuna',
    kind: 'Server',
    categoryTitle: 'Traders',
    thumbnail: 'https://files.sp-mod.com/mods/lotus.png',
    fikaCompatibility: true,
    version: '1.0.0',
    teaser: 'Custom anime-themed trader offering specialized medical supplies, ammunition, and gear.',
  }
};

/**
 * Returns rich metadata for any known dependency by matching GUID, slug, or name.
 */
export function getKnownDependencyMeta(idOrGuidOrName?: string | number): KnownDependencyMeta | null {
  if (!idOrGuidOrName) return null;
  const str = String(idOrGuidOrName).toLowerCase().trim();

  if (KNOWN_DEPENDENCIES[str]) return KNOWN_DEPENDENCIES[str];

  for (const [key, meta] of Object.entries(KNOWN_DEPENDENCIES)) {
    if (
      key.toLowerCase() === str ||
      meta.guid.toLowerCase() === str ||
      meta.name.toLowerCase() === str ||
      String(meta.id) === str
    ) {
      return meta;
    }
  }

  // Substring matching for CommonLib
  if (str.includes('commonlib') || str.includes('wtt')) {
    return KNOWN_DEPENDENCIES['com.wtt.commonlib'];
  }
  if (str.includes('bigbrain')) {
    return KNOWN_DEPENDENCIES['xyz.drakia.bigbrain'];
  }
  if (str.includes('waypoints')) {
    return KNOWN_DEPENDENCIES['xyz.drakia.waypoints'];
  }
  if (str.includes('sain')) {
    return KNOWN_DEPENDENCIES['me.sol.sain'];
  }
  if (str.includes('svm') || str.includes('server value modifier')) {
    return KNOWN_DEPENDENCIES['fika.ghostfenixx.svm'];
  }

  return null;
}
