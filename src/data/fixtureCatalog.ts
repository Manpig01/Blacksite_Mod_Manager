import { Mod, ModCategory, SptVersionInfo, InstalledMod, ModProfile, ConflictInfo } from '../types';

export const SPT_VERSIONS: SptVersionInfo[] = [
  { id: 55, version: "4.1.6", versionMajor: 4, versionMinor: 1, versionPatch: 6, versionLabels: "", modCount: 431, link: "https://github.com/SP-Tushonka/build/releases/tag/4.1.6", colorClass: "green" },
  { id: 54, version: "4.1.5", versionMajor: 4, versionMinor: 1, versionPatch: 5, versionLabels: "", modCount: 420, link: "https://github.com/SP-Tushonka/build/releases/tag/4.1.5", colorClass: "green" },
  { id: 53, version: "4.1.4", versionMajor: 4, versionMinor: 1, versionPatch: 4, versionLabels: "", modCount: 407, link: "https://github.com/SP-Tushonka/build/releases/tag/4.1.4", colorClass: "green" },
  { id: 48, version: "4.0.13", versionMajor: 4, versionMinor: 0, versionPatch: 13, versionLabels: "", modCount: 765, link: "https://github.com/sp-tarkov/build/releases/tag/4.0.13", colorClass: "violet" },
  { id: 44, version: "4.0.12", versionMajor: 4, versionMinor: 0, versionPatch: 12, versionLabels: "", modCount: 585, link: "https://github.com/sp-tarkov/build/releases/tag/4.0.12", colorClass: "violet" },
  { id: 43, version: "4.0.11", versionMajor: 4, versionMinor: 0, versionPatch: 11, versionLabels: "", modCount: 572, link: "https://github.com/sp-tarkov/build/releases/tag/4.0.11", colorClass: "violet" },
  { id: 42, version: "4.0.10", versionMajor: 4, versionMinor: 0, versionPatch: 10, versionLabels: "", modCount: 556, link: "https://github.com/sp-tarkov/build/releases/tag/4.0.10", colorClass: "violet" },
  { id: 32, version: "4.0.0", versionMajor: 4, versionMinor: 0, versionPatch: 0, versionLabels: "", modCount: 474, link: "https://github.com/sp-tarkov/build/releases/tag/4.0.0", colorClass: "violet" },
  { id: 2, version: "3.11.4", versionMajor: 3, versionMinor: 11, versionPatch: 4, versionLabels: "", modCount: 666, link: "https://github.com/sp-tarkov/build/releases/tag/3.11.4", colorClass: "red" },
  { id: 7, version: "3.10.5", versionMajor: 3, versionMinor: 10, versionPatch: 5, versionLabels: "", modCount: 454, link: "https://github.com/sp-tarkov/build/releases/tag/3.10.5", colorClass: "red" },
  { id: 21, version: "3.9.0", versionMajor: 3, versionMinor: 9, versionPatch: 0, versionLabels: "", modCount: 454, link: "https://github.com/sp-tarkov/build/releases/tag/3.9.0", colorClass: "red" },
  { id: 25, version: "3.8.0", versionMajor: 3, versionMinor: 8, versionPatch: 0, versionLabels: "", modCount: 369, link: "https://github.com/sp-tarkov/build/releases/tag/3.8.0", colorClass: "red" }
];

export const MOD_CATEGORIES: ModCategory[] = [
  { id: 5, hub_id: 22, title: "Bots", slug: "bots", description: "AI behavior, brain routines, and bot equipment" },
  { id: 2, hub_id: 79, title: "Overhauls", slug: "overhauls", description: "Large-scale mod packs that overhaul many game systems" },
  { id: 17, hub_id: 28, title: "Other", slug: "other", description: "General utilities and misc gameplay mods" },
  { id: 10, hub_id: 26, title: "Retextures", slug: "retextures", description: "Visual enhancements, post-processing, shaders" },
  { id: 16, hub_id: 29, title: "Traders", slug: "traders", description: "Custom traders, quests, and market stocks" },
  { id: 4, hub_id: 21, title: "Items", slug: "items", description: "New weapons, gear, attachments, and cases" },
  { id: 13, hub_id: 76, title: "Weapons", slug: "weapons", description: "Custom firearms, recoil tweaks, and sights" },
  { id: 12, hub_id: 75, title: "Audio", slug: "audio", description: "Sound overhauls, footsteps, ear protection balance" },
  { id: 7, hub_id: 24, title: "Quests", slug: "quests", description: "Expanded quest lines and custom objectives" },
  { id: 6, hub_id: 23, title: "Hideout", slug: "hideout", description: "Hideout crafting, building time tweaks, generators" },
  { id: 1, hub_id: 17, title: "Tools", slug: "tools", description: "Standalone managers and development helpers" }
];

export const FIXTURE_MODS: Mod[] = [
  {
    id: 3084,
    hub_id: null,
    guid: "com.custom.flashlightmodifier",
    name: "Better Flashlights",
    slug: "better-flashlights",
    teaser: "A lightweight, tactical flashlight overhaul for players and bots with custom Kelvin temperature and procedural beams",
    thumbnail: "https://files.sp-mod.com/mods/QZiC1tunsf7P5tSiRfunb6JnKMUtp5PtKv7OVgwl.png",
    downloads: 156,
    favourites_count: 4,
    endorsements_count: 1,
    detail_url: "https://sp-mod.com/mod/3084/better-flashlights",
    fika_compatibility: false,
    featured: false,
    contains_ads: false,
    cheat_notice: false,
    category_id: 15,
    published_at: "2026-09-30T03:19:00.000000Z",
    owner: {
      id: 36725,
      name: "ThanashsK",
      profile_photo_url: "https://files.sp-mod.com/profile-photos/iNJLEanYXhS3HEyeSZGWrDpxbtKBHqtJoBqHjqOw_128w.webp"
    },
    versions: [
      {
        id: 14201,
        version: "1.0.0",
        description: "<p>Tactical flashlight overhaul with procedural Kelvin beam rendering.</p>",
        link: "https://files.sp-mod.com/mods/better-flashlights-1.0.0.zip",
        content_length: 150000,
        spt_version_constraint: ">=4.0.0",
        downloads: 156,
        fika_compatibility: "compatible",
        published_at: "2026-09-30T03:19:00.000000Z"
      }
    ]
  },
  {
    id: 3083,
    hub_id: null,
    guid: "com.hj.modsource",
    name: "Hj's Mod Source",
    slug: "hjs-mod-source",
    teaser: "See which mod added what",
    thumbnail: "https://files.sp-mod.com/mods/a58M5EaTtl9uVfHftBNe8qJavelmthBkLbCAFHMN.jpg",
    downloads: 137,
    favourites_count: 6,
    endorsements_count: 5,
    detail_url: "https://sp-mod.com/mod/3083/hjs-mod-source",
    fika_compatibility: false,
    featured: false,
    contains_ads: false,
    cheat_notice: false,
    category_id: 1,
    published_at: "2026-09-29T23:52:00.000000Z",
    owner: {
      id: 2059,
      name: "Hj",
      profile_photo_url: "https://files.sp-mod.com/profile-photos/R7T9Uom9mp9FnxyIGz44xarnoLa15G4Bvi68xk82_256w.webp"
    },
    versions: [
      {
        id: 14202,
        version: "1.0.0",
        description: "<p>Source indicator for custom items, traders and scripts.</p>",
        link: "https://files.sp-mod.com/mods/hjs-mod-source-1.0.0.zip",
        content_length: 85000,
        spt_version_constraint: ">=4.0.0",
        downloads: 137,
        fika_compatibility: "compatible",
        published_at: "2026-09-29T23:52:00.000000Z"
      }
    ]
  },
  {
    id: 3082,
    hub_id: null,
    guid: "com.hj.taskitemindicator",
    name: "Hj's Task Item Indicator",
    slug: "hjs-task-item-indicator",
    teaser: "1:1 Task Item Indicator Ring from EFT 1.0.5",
    thumbnail: "https://files.sp-mod.com/mods/1946QM5zEatL3eVE0Pp3nPGvasEUXQa12XGzf1xy.png",
    downloads: 188,
    favourites_count: 8,
    endorsements_count: 5,
    detail_url: "https://sp-mod.com/mod/3082/hjs-task-item-indicator",
    fika_compatibility: true,
    featured: false,
    contains_ads: false,
    cheat_notice: false,
    category_id: 1,
    published_at: "2026-09-29T22:16:00.000000Z",
    owner: {
      id: 2059,
      name: "Hj",
      profile_photo_url: "https://files.sp-mod.com/profile-photos/R7T9Uom9mp9FnxyIGz44xarnoLa15G4Bvi68xk82_256w.webp"
    },
    versions: [
      {
        id: 14203,
        version: "1.0.0",
        description: "<p>1:1 Task item indicator ring from modern EFT branch.</p>",
        link: "https://files.sp-mod.com/mods/hjs-task-item-indicator-1.0.0.zip",
        content_length: 120000,
        spt_version_constraint: ">=4.0.0",
        downloads: 188,
        fika_compatibility: "compatible",
        published_at: "2026-09-29T22:16:00.000000Z"
      }
    ]
  },
  {
    id: 3081,
    hub_id: null,
    guid: "com.hj.advancedmoddinglights",
    name: "Advanced Modding Lights",
    slug: "advanced-modding-lights",
    teaser: "Enhance the lighting in weapon modding and build screens for better visibility and aesthetics",
    thumbnail: "https://files.sp-mod.com/mods/LT32yx2pZ84ndn1ZTbsOl01enfXNVtmXYZ5j1qOD.jpg",
    downloads: 205,
    favourites_count: 4,
    endorsements_count: 7,
    detail_url: "https://sp-mod.com/mod/3081/advanced-modding-lights",
    fika_compatibility: true,
    featured: false,
    contains_ads: false,
    cheat_notice: false,
    category_id: 10,
    published_at: "2026-09-29T18:26:00.000000Z",
    owner: {
      id: 2059,
      name: "Hj",
      profile_photo_url: "https://files.sp-mod.com/profile-photos/R7T9Uom9mp9FnxyIGz44xarnoLa15G4Bvi68xk82_256w.webp"
    },
    versions: [
      {
        id: 14204,
        version: "2.0.0",
        description: "<p>Weapon workbench lighting enhancements.</p>",
        link: "https://files.sp-mod.com/mods/aml-2.0.0.zip",
        content_length: 340000,
        spt_version_constraint: ">=4.0.0",
        downloads: 205,
        fika_compatibility: "compatible",
        published_at: "2026-09-29T18:26:00.000000Z"
      }
    ]
  },
  {
    id: 3080,
    hub_id: null,
    guid: "com.vektys.raidrecovery",
    name: "Raid Recovery",
    slug: "raid-recovery",
    teaser: "Resume your raid after a crash. Gear, health, position, loot, bots and quests are restored, with the live reconnect screen.",
    thumbnail: "https://files.sp-mod.com/mods/W8YSrL60WMYqoGV3UIc4Gifo4dn6InkMESSgXV6V.png",
    downloads: 239,
    favourites_count: 11,
    endorsements_count: 7,
    detail_url: "https://sp-mod.com/mod/3080/raid-recovery",
    fika_compatibility: true,
    featured: false,
    contains_ads: false,
    cheat_notice: false,
    category_id: 17,
    published_at: "2026-09-29T11:53:00.000000Z",
    owner: { id: 3120, name: "vektys", profile_photo_url: null },
    versions: [
      {
        id: 14205,
        version: "1.2.2",
        description: "<p>State persistence recovery for interrupted raids.</p>",
        link: "https://files.sp-mod.com/mods/raid-recovery-1.2.2.zip",
        content_length: 420000,
        spt_version_constraint: ">=4.0.0",
        downloads: 239,
        fika_compatibility: "compatible",
        published_at: "2026-09-29T11:53:00.000000Z"
      }
    ]
  },
  {
    id: 3079,
    hub_id: null,
    guid: "com.falconpilot.tagovername",
    name: "Tag Over Name",
    slug: "tag-over-name",
    teaser: "Hide an item's name when it has a tag. Finally organize your stash properly!",
    thumbnail: "https://files.sp-mod.com/mods/asMuZOkqnvjQEHG027KaUKxmbmrdo9LgzYX33Xe5.jpg",
    downloads: 169,
    favourites_count: 2,
    endorsements_count: 4,
    detail_url: "https://sp-mod.com/mod/3079/tag-over-name",
    fika_compatibility: false,
    featured: false,
    contains_ads: false,
    cheat_notice: false,
    category_id: 4,
    published_at: "2026-09-29T05:15:00.000000Z",
    owner: { id: 4410, name: "FalconPilot", profile_photo_url: null },
    versions: [
      {
        id: 14206,
        version: "1.0.2",
        description: "<p>Stash item tag visual priority.</p>",
        link: "https://files.sp-mod.com/mods/tag-over-name-1.0.2.zip",
        content_length: 65000,
        spt_version_constraint: ">=4.0.0",
        downloads: 169,
        fika_compatibility: "compatible",
        published_at: "2026-09-29T05:15:00.000000Z"
      }
    ]
  },
  {
    id: 3078,
    hub_id: null,
    guid: "com.evgencheg.iconchanger",
    name: "Icon Changer",
    slug: "icon-changer",
    teaser: "Adds the ability to give your account icons: Sherpa, Emissary or Developer.",
    thumbnail: "https://files.sp-mod.com/mods/Pxvf6o1n0lOdA4wbb0jAjpJh9lgTsYz84p4Ig56r.jpg",
    downloads: 90,
    favourites_count: 5,
    endorsements_count: 3,
    detail_url: "https://sp-mod.com/mod/3078/icon-changer",
    fika_compatibility: true,
    featured: false,
    contains_ads: false,
    cheat_notice: false,
    category_id: 1,
    published_at: "2026-09-28T20:42:00.000000Z",
    owner: { id: 5512, name: "Evgencheg", profile_photo_url: null },
    versions: [
      {
        id: 14207,
        version: "1.0.1",
        description: "<p>Sherpa and Dev role badges.</p>",
        link: "https://files.sp-mod.com/mods/icon-changer-1.0.1.zip",
        content_length: 95000,
        spt_version_constraint: ">=4.0.0",
        downloads: 90,
        fika_compatibility: "compatible",
        published_at: "2026-09-28T20:42:00.000000Z"
      }
    ]
  },
  {
    id: 3077,
    hub_id: null,
    guid: "com.eliteonetube.pityloot",
    name: "PityLoot",
    slug: "pityloot",
    teaser: "Can't find that one quest item? Every raid without it makes it more likely to spawn. Pity loot for quests, hideout upgrades, quest keys and Gunsmith parts.",
    thumbnail: "https://files.sp-mod.com/mods/3a45QiB4qfDluC9UsK8ffR9yIgN9ngLXsNk7seYE.png",
    downloads: 263,
    favourites_count: 7,
    endorsements_count: 6,
    detail_url: "https://sp-mod.com/mod/3077/pityloot",
    fika_compatibility: false,
    featured: false,
    contains_ads: false,
    cheat_notice: false,
    category_id: 7,
    published_at: "2026-09-28T20:07:00.000000Z",
    owner: { id: 6120, name: "EliteOneTube", profile_photo_url: null },
    versions: [
      {
        id: 14208,
        version: "1.0.0",
        description: "<p>Dynamic pity spawn scaling.</p>",
        link: "https://files.sp-mod.com/mods/pityloot-1.0.0.zip",
        content_length: 180000,
        spt_version_constraint: ">=4.0.0",
        downloads: 263,
        fika_compatibility: "compatible",
        published_at: "2026-09-28T20:07:00.000000Z"
      }
    ]
  },
  {
    id: 3076,
    hub_id: null,
    guid: "com.pj568.performancescope",
    name: "Performance Scope",
    slug: "performance-scope",
    teaser: "Adjust in scope resolution, make PiP sharper or increase FPS.",
    thumbnail: "https://files.sp-mod.com/mods/x5ul7gz8Iqa7A3KKhy6RCJrRIQ8q3ev2njmu2WOr.png",
    downloads: 458,
    favourites_count: 11,
    endorsements_count: 7,
    detail_url: "https://sp-mod.com/mod/3076/performance-scope",
    fika_compatibility: true,
    featured: false,
    contains_ads: false,
    cheat_notice: false,
    category_id: 10,
    published_at: "2026-09-28T19:25:00.000000Z",
    owner: { id: 8701, name: "PJ568", profile_photo_url: null },
    versions: [
      {
        id: 14209,
        version: "0.2.0",
        description: "<p>PiP scope rendering optimizations.</p>",
        link: "https://files.sp-mod.com/mods/performance-scope-0.2.0.zip",
        content_length: 250000,
        spt_version_constraint: ">=4.0.0",
        downloads: 458,
        fika_compatibility: "compatible",
        published_at: "2026-09-28T19:25:00.000000Z"
      }
    ]
  },
  {
    id: 3075,
    hub_id: null,
    guid: "bodycamera",
    name: "BodyCamera",
    slug: "bodycamera",
    teaser: "A more immersive camera experience with natural movement, realistic inertia and dynamic camera shake.",
    thumbnail: "https://files.sp-mod.com/mods/kkjKpzIm96i342pLUGgtkaLGZvDnwtf4IyZnuszy.png",
    downloads: 347,
    favourites_count: 11,
    endorsements_count: 13,
    detail_url: "https://sp-mod.com/mod/3075/bodycamera",
    fika_compatibility: false,
    featured: false,
    contains_ads: false,
    cheat_notice: false,
    category_id: 3,
    published_at: "2026-09-28T18:00:00.000000Z",
    owner: {
      id: 124874,
      name: "RedSparrow",
      profile_photo_url: "https://files.sp-mod.com/profile-photos/ThaYhTkf5IsQ1q1hhvauZBAPeDqVNR1jwGTg0qJD_256w.webp"
    },
    versions: [
      {
        id: 14210,
        version: "0.2.9",
        description: "<p>Inertia, dynamic roll, and camera shake module.</p>",
        link: "https://files.sp-mod.com/mods/bodycamera-0.2.9.zip",
        content_length: 580000,
        spt_version_constraint: ">=4.0.0",
        downloads: 347,
        fika_compatibility: "compatible",
        published_at: "2026-09-28T18:00:00.000000Z"
      }
    ]
  },
  {
    id: 902,
    hub_id: 1219,
    guid: "xyz.drakia.bigbrain",
    name: "BigBrain",
    slug: "bigbrain",
    teaser: "A library for adding extra logic layers to existing bot brains",
    thumbnail: "https://files.sp-mod.com/profile-photos/3QNnXtLVCemFEnHBPEbJlHUotMxBLgyZ69qLxgnZ_256w.webp",
    downloads: 1339021,
    favourites_count: 1051,
    endorsements_count: 54,
    detail_url: "https://sp-mod.com/mod/902/bigbrain",
    fika_compatibility: true,
    featured: true,
    contains_ads: false,
    contains_ai_content: false,
    cheat_notice: false,
    category_id: 5,
    published_at: "2023-05-31T03:20:00.000000Z",
    owner: { id: 27605, name: "DrakiaXYZ", profile_photo_url: "https://files.sp-mod.com/profile-photos/3QNnXtLVCemFEnHBPEbJlHUotMxBLgyZ69qLxgnZ_256w.webp" },
    additional_authors: [],
    category: { id: 5, title: "Bots", slug: "bots" },
    versions: [
      {
        id: 14001,
        version: "1.1.2",
        description: "<p>Updated for SPT 4.0.12+ and 4.1.x compatibility. Added thread-safe action evaluators and fixed memory leak in decision tree cycles.</p>",
        link: "https://files.sp-mod.com/mods/bigbrain-1.1.2.zip",
        content_length: 48920,
        spt_version_constraint: ">=4.0.0",
        downloads: 412000,
        fika_compatibility: "compatible",
        published_at: "2026-08-01T12:00:00Z"
      },
      {
        id: 13500,
        version: "1.1.0",
        description: "<p>Initial support for SPT 4.0 release branch.</p>",
        link: "https://files.sp-mod.com/mods/bigbrain-1.1.0.zip",
        content_length: 47800,
        spt_version_constraint: ">=4.0.0",
        downloads: 289000,
        fika_compatibility: "compatible",
        published_at: "2025-11-10T12:00:00Z"
      }
    ]
  },
  {
    id: 236,
    hub_id: 379,
    guid: "fika.ghostfenixx.svm",
    name: "Server Value Modifier [SVM]",
    slug: "server-value-modifier-svm",
    teaser: "Swiss knife of SPT. Standalone extensive All-In-One Server mod that comes with User Interface and a huge variety of options",
    thumbnail: "https://files.sp-mod.com/mods/379.png",
    downloads: 1313659,
    favourites_count: 673,
    endorsements_count: 68,
    detail_url: "https://sp-mod.com/mod/236/server-value-modifier-svm",
    fika_compatibility: true,
    featured: true,
    contains_ads: false,
    contains_ai_content: false,
    cheat_notice: false,
    category_id: 2,
    published_at: "2021-09-26T22:01:00.000000Z",
    owner: { id: 3972, name: "GhostFenixx", profile_photo_url: "https://files.sp-mod.com/profile-photos/6b26056cefeb30ad605def9f0f3fa58feface48e_128w.webp" },
    additional_authors: [],
    category: { id: 2, title: "Overhauls", slug: "overhauls" },
    versions: [
      {
        id: 14002,
        version: "1.9.1",
        description: "<p>Full support for SPT 4.x runtime folders. Added custom pocket presets, dynamic flea market pricing scales, and hideout instant upgrade options.</p>",
        link: "https://files.sp-mod.com/mods/svm-1.9.1.zip",
        content_length: 12845000,
        spt_version_constraint: ">=4.0.0",
        downloads: 512000,
        fika_compatibility: "compatible",
        published_at: "2026-08-20T14:30:00Z"
      }
    ]
  },
  {
    id: 827,
    hub_id: 1119,
    guid: "xyz.drakia.waypoints",
    name: "Waypoints - Expanded Navmesh",
    slug: "waypoints-expanded-navmesh",
    teaser: "Expand where bots can explore with full map navmesh coverage!",
    thumbnail: "https://files.sp-mod.com/mods/1119.png",
    downloads: 1312704,
    favourites_count: 966,
    endorsements_count: 52,
    detail_url: "https://sp-mod.com/mod/827/waypoints-expanded-navmesh",
    fika_compatibility: true,
    featured: false,
    contains_ads: false,
    contains_ai_content: false,
    cheat_notice: false,
    category_id: 17,
    published_at: "2023-04-03T04:38:00.000000Z",
    owner: { id: 27605, name: "DrakiaXYZ", profile_photo_url: "https://files.sp-mod.com/profile-photos/3QNnXtLVCemFEnHBPEbJlHUotMxBLgyZ69qLxgnZ_256w.webp" },
    additional_authors: [],
    category: { id: 17, title: "Other", slug: "other" },
    versions: [
      {
        id: 14003,
        version: "1.4.3",
        description: "<p>Groundwork navmesh updates for Streets of Tarkov expansion and Ground Zero low/high brackets.</p>",
        link: "https://files.sp-mod.com/mods/waypoints-1.4.3.zip",
        content_length: 32000000,
        spt_version_constraint: ">=4.0.0",
        downloads: 480000,
        fika_compatibility: "compatible",
        published_at: "2026-07-15T18:00:00Z"
      }
    ]
  },
  {
    id: 791,
    hub_id: 1062,
    guid: "me.sol.sain",
    name: "SAIN - Solarint's AI Modifications",
    slug: "sain-solarints-ai-modifications",
    teaser: "Full AI Combat System Replacement: intelligent peek angles, dynamic suppression, blind fire, and squad coordination",
    thumbnail: "https://files.sp-mod.com/mods/1062.jpg",
    downloads: 1298751,
    favourites_count: 833,
    endorsements_count: 106,
    detail_url: "https://sp-mod.com/mod/791/sain-solarints-ai-modifications-full-ai-combat-system-replacement",
    fika_compatibility: true,
    featured: true,
    contains_ads: false,
    contains_ai_content: false,
    cheat_notice: false,
    category_id: 5,
    published_at: "2023-03-09T02:46:00.000000Z",
    owner: { id: 27463, name: "Solarint", profile_photo_url: "https://files.sp-mod.com/profile-photos/9fa66985990895e0c115adbdee4dbf71409d1566_128w.webp" },
    additional_authors: [
      { id: 27605, name: "DrakiaXYZ", profile_photo_url: null },
      { id: 52282, name: "ArchangelWTF", profile_photo_url: null }
    ],
    category: { id: 5, title: "Bots", slug: "bots" },
    versions: [
      {
        id: 14004,
        version: "3.0.5",
        description: "<p>Performance overhaul, realistic CQB push timing, voice-line trigger fix for Fika host-client sync.</p>",
        link: "https://files.sp-mod.com/mods/sain-3.0.5.zip",
        content_length: 5120000,
        spt_version_constraint: ">=4.0.0",
        downloads: 420000,
        fika_compatibility: "compatible",
        published_at: "2026-09-02T10:00:00Z"
      }
    ]
  },
  {
    id: 592,
    hub_id: 813,
    guid: "com.amanda.graphics",
    name: "Amands's Graphics",
    slug: "amandss-graphics",
    teaser: "Lighting, postprocessing overhaul, fog removal, and indoor illumination fix without performance loss",
    thumbnail: "https://files.sp-mod.com/mods/813.png",
    downloads: 860797,
    favourites_count: 389,
    endorsements_count: 40,
    detail_url: "https://sp-mod.com/mod/592/amandss-graphics",
    fika_compatibility: true,
    featured: false,
    contains_ads: false,
    contains_ai_content: false,
    cheat_notice: false,
    category_id: 10,
    published_at: "2022-09-01T14:49:00.000000Z",
    owner: { id: 15487, name: "Amands2Mello", profile_photo_url: "https://files.sp-mod.com/profile-photos/97ec3be3b53f6769474e8ffddbf02f1d1ea005e5_128w.webp" },
    additional_authors: [],
    category: { id: 10, title: "Retextures", slug: "retextures" },
    versions: [
      {
        id: 14005,
        version: "2.3.0",
        description: "<p>Updated depth buffer rendering for Unity 2022, HDR tone-mapping calibration, presets for Interchange lighting.</p>",
        link: "https://files.sp-mod.com/mods/amands-graphics-2.3.0.zip",
        content_length: 1250000,
        spt_version_constraint: ">=4.0.0",
        downloads: 380000,
        fika_compatibility: "compatible",
        published_at: "2026-08-12T16:00:00Z"
      }
    ]
  },
  {
    id: 31,
    hub_id: 76,
    guid: "com.donut.scavcat",
    name: "Scav Cat Trader Mod",
    slug: "scav-cat-trader-mod",
    teaser: "Scav Cat sells cases. These cases are ALOT. Cheaper. Unique barter items and vodka currency!",
    thumbnail: "https://files.sp-mod.com/mods/76.jpg",
    downloads: 13759,
    favourites_count: 10,
    endorsements_count: 5,
    detail_url: "https://sp-mod.com/mod/31/scav-cat-trader-mod",
    fika_compatibility: false,
    featured: false,
    contains_ads: false,
    contains_ai_content: false,
    cheat_notice: false,
    category_id: 16,
    published_at: "2021-01-01T07:22:00.000000Z",
    owner: { id: 355, name: "DonutxLord", profile_photo_url: null },
    additional_authors: [],
    category: { id: 16, title: "Traders", slug: "traders" },
    versions: [
      {
        id: 12710,
        version: "1.0.8",
        description: "<p><strong>Scav Cat sells cases. These cases are ALOT. Cheaper.</strong></p><p>Barters balanced for SPT 4.0 economics.</p>",
        link: "https://files.sp-mod.com/mods/scavcat-1.0.8.zip",
        content_length: 43815,
        spt_version_constraint: "4.0.10",
        downloads: 4896,
        fika_compatibility: "unknown",
        published_at: "2025-12-29T20:52:00Z"
      }
    ]
  },
  {
    id: 412,
    guid: "com.fontaine.realism",
    name: "SPT Realism Mod",
    slug: "spt-realism-mod",
    teaser: "Complete combat, health, ballistics, recoil, armor plate simulation and economy rebalance for SPT",
    thumbnail: "",
    downloads: 980140,
    favourites_count: 612,
    endorsements_count: 77,
    detail_url: "https://sp-mod.com/mod/412/spt-realism-mod",
    fika_compatibility: true,
    featured: true,
    contains_ads: false,
    contains_ai_content: false,
    cheat_notice: false,
    category_id: 2,
    published_at: "2022-04-10T15:00:00Z",
    owner: { id: 18204, name: "Fontaine", profile_photo_url: null },
    additional_authors: [],
    category: { id: 2, title: "Overhauls", slug: "overhauls" },
    versions: [
      {
        id: 14006,
        version: "1.3.1",
        description: "<p>Added armor plate hitboxes compatibility, revised stance system, updated bleeding mechanics.</p>",
        link: "https://files.sp-mod.com/mods/realism-1.3.1.zip",
        content_length: 64500000,
        spt_version_constraint: ">=4.0.0",
        downloads: 215000,
        fika_compatibility: "compatible",
        published_at: "2026-08-30T19:00:00Z"
      }
    ]
  },
  {
    id: 610,
    guid: "xyz.drakia.lootingbots",
    name: "Looting Bots",
    slug: "looting-bots",
    teaser: "Enables AI scavs and PMCs to loot containers, loose loot, and dead bodies realistically",
    thumbnail: "",
    downloads: 750200,
    favourites_count: 420,
    endorsements_count: 38,
    detail_url: "https://sp-mod.com/mod/610/looting-bots",
    fika_compatibility: true,
    featured: false,
    contains_ads: false,
    contains_ai_content: false,
    cheat_notice: false,
    category_id: 5,
    published_at: "2023-01-20T10:00:00Z",
    owner: { id: 27605, name: "DrakiaXYZ", profile_photo_url: null },
    category: { id: 5, title: "Bots", slug: "bots" },
    versions: [
      {
        id: 14007,
        version: "1.3.4",
        description: "<p>Fixed container lockups and improved PMC item valuation logic.</p>",
        link: "https://files.sp-mod.com/mods/lootingbots-1.3.4.zip",
        content_length: 1200000,
        spt_version_constraint: ">=4.0.0",
        downloads: 310000,
        fika_compatibility: "compatible",
        published_at: "2026-08-14T11:00:00Z"
      }
    ]
  }
];

export const INITIAL_INSTALLED_MODS: InstalledMod[] = [
  {
    id: "xyz.drakia.bigbrain",
    modId: 902,
    name: "BigBrain",
    version: "1.1.2",
    author: "DrakiaXYZ",
    kind: "Client",
    categoryTitle: "Bots",
    thumbnail: "https://files.sp-mod.com/profile-photos/3QNnXtLVCemFEnHBPEbJlHUotMxBLgyZ69qLxgnZ_256w.webp",
    teaser: "A library for adding extra logic layers to existing bot brains",
    sptVersion: "4.0.12",
    fikaCompatibility: true,
    installDate: "2026-09-10",
    clientPath: "BepInEx/plugins/DrakiaXYZ-BigBrain.dll",
    isDisabled: false,
    hasUpdate: false,
    latestVersion: "1.1.2",
    loadOrder: 1,
    dependencies: [],
    tags: [
      { id: 'tag-core', name: 'Core AI', color: '#8B5CF6' },
      { id: 'tag-essential', name: 'Essential', color: '#10B981' }
    ],
    configFiles: [
      {
        id: "cfg-1",
        fileName: "xyz.drakia.bigbrain.cfg",
        relativePath: "BepInEx/config/xyz.drakia.bigbrain.cfg",
        fileType: "cfg",
        content: `[General]\n# Enable verbose AI layer decision logging\nDebugLogging = false\n# Maximum evaluation duration per frame (ms)\nMaxEvaluationTimeMs = 5.0\n# Thread pooling for background decisions\nEnableThreadPool = true\n`,
        originalContent: `[General]\n# Enable verbose AI layer decision logging\nDebugLogging = false\n# Maximum evaluation duration per frame (ms)\nMaxEvaluationTimeMs = 5.0\n# Thread pooling for background decisions\nEnableThreadPool = true\n`
      }
    ]
  },
  {
    id: "fika.ghostfenixx.svm",
    modId: 236,
    name: "Server Value Modifier [SVM]",
    version: "1.9.0",
    author: "GhostFenixx",
    kind: "Both",
    categoryTitle: "Overhauls",
    thumbnail: "https://files.sp-mod.com/mods/379.png",
    teaser: "Swiss knife of SPT. Extensive All-In-One Server mod with user configuration options",
    sptVersion: "4.0.12",
    fikaCompatibility: true,
    installDate: "2026-09-12",
    serverPath: "SPT_Runtime/user/mods/ServerValueModifier",
    clientPath: "BepInEx/plugins/SVM-Helper.dll",
    isDisabled: false,
    hasUpdate: true,
    latestVersion: "1.9.1",
    loadOrder: 2,
    dependencies: [],
    tags: [
      { id: 'tag-server', name: 'Server', color: '#F59E0B' },
      { id: 'tag-overhaul', name: 'Overhaul', color: '#EC4899' }
    ],
    configFiles: [
      {
        id: "cfg-2",
        fileName: "presets.json",
        relativePath: "SPT_Runtime/user/mods/ServerValueModifier/presets/custom.json",
        fileType: "json",
        content: `{\n  "EnableSVM": true,\n  "RaidTime": {\n    "CustomRaidTimes": false,\n    "TimeMultiplier": 1.0\n  },\n  "FleaMarket": {\n    "DisableBlacklist": true,\n    "LevelRequirement": 5,\n    "FeeMultiplier": 0.5\n  },\n  "Player": {\n    "PocketSizePreset": "Pockets1x4",\n    "ScavCooldownSeconds": 300\n  }\n}`,
        originalContent: `{\n  "EnableSVM": true,\n  "RaidTime": {\n    "CustomRaidTimes": false,\n    "TimeMultiplier": 1.0\n  },\n  "FleaMarket": {\n    "DisableBlacklist": true,\n    "LevelRequirement": 5,\n    "FeeMultiplier": 0.5\n  },\n  "Player": {\n    "PocketSizePreset": "Pockets1x4",\n    "ScavCooldownSeconds": 300\n  }\n}`
      }
    ]
  },
  {
    id: "me.sol.sain",
    modId: 791,
    name: "SAIN - Solarint's AI Modifications",
    version: "3.0.5",
    author: "Solarint",
    kind: "Client",
    categoryTitle: "Bots",
    thumbnail: "https://files.sp-mod.com/mods/1062.jpg",
    teaser: "Full AI Combat System Replacement: intelligent peek angles and dynamic suppression",
    sptVersion: "4.0.12",
    fikaCompatibility: true,
    installDate: "2026-09-15",
    clientPath: "BepInEx/plugins/SAIN.dll",
    isDisabled: false,
    hasUpdate: false,
    latestVersion: "3.0.5",
    loadOrder: 3,
    dependencies: ["xyz.drakia.bigbrain"],
    tags: [
      { id: 'tag-core', name: 'Core AI', color: '#8B5CF6' },
      { id: 'tag-combat', name: 'Combat', color: '#EF4444' }
    ],
    configFiles: [
      {
        id: "cfg-3",
        fileName: "SAIN.json",
        relativePath: "BepInEx/config/SAIN/SAIN.json",
        fileType: "json",
        content: `{\n  "Difficulty": "Default",\n  "GlobalRecoilMultiplier": 1.0,\n  "BotAimSpeedMultiplier": 1.0,\n  "EnableHeadshotProtection": true,\n  "DynamicHearingRange": true\n}`,
        originalContent: `{\n  "Difficulty": "Default",\n  "GlobalRecoilMultiplier": 1.0,\n  "BotAimSpeedMultiplier": 1.0,\n  "EnableHeadshotProtection": true,\n  "DynamicHearingRange": true\n}`
      }
    ]
  },
  {
    id: "com.amanda.graphics",
    modId: 592,
    name: "Amands's Graphics",
    version: "2.3.0",
    author: "Amands2Mello",
    kind: "Client",
    categoryTitle: "Retextures",
    thumbnail: "https://files.sp-mod.com/mods/813.png",
    teaser: "Lighting and postprocessing overhaul",
    sptVersion: "4.0.12",
    fikaCompatibility: true,
    installDate: "2026-09-18",
    clientPath: "BepInEx/plugins/AmandsGraphics.dll",
    isDisabled: false,
    hasUpdate: false,
    latestVersion: "2.3.0",
    loadOrder: 4,
    dependencies: [],
    tags: [
      { id: 'tag-visuals', name: 'Visuals', color: '#06B6D4' }
    ],
    configFiles: [
      {
        id: "cfg-4",
        fileName: "AmandsGraphics.cfg",
        relativePath: "BepInEx/config/AmandsGraphics.cfg",
        fileType: "cfg",
        content: `[Lighting]\nEnableHdr = true\nTonemapper = ACES\nIndoorBrightnessBoost = 1.25\nNightVisionTweaks = true\n`,
        originalContent: `[Lighting]\nEnableHdr = true\nTonemapper = ACES\nIndoorBrightnessBoost = 1.25\nNightVisionTweaks = true\n`
      }
    ]
  }
];

export const INITIAL_PROFILES: ModProfile[] = [
  {
    id: "prof-1",
    name: "Default Loadout",
    description: "All installed mods active and enabled",
    enabledModIds: ["xyz.drakia.bigbrain", "fika.ghostfenixx.svm", "me.sol.sain", "com.amanda.graphics"],
    createdDate: "2026-09-01"
  },
  {
    id: "prof-2",
    name: "Vanilla+ Minimal",
    description: "Performance and AI tweaks only, no server overhauls",
    enabledModIds: ["xyz.drakia.bigbrain", "me.sol.sain", "com.amanda.graphics"],
    createdDate: "2026-09-05"
  },
  {
    id: "prof-3",
    name: "Fika Co-op Sync",
    description: "Matched loadout for headless server and clients",
    enabledModIds: ["xyz.drakia.bigbrain", "fika.ghostfenixx.svm", "me.sol.sain"],
    createdDate: "2026-09-12"
  }
];

export const INITIAL_CONFLICTS: ConflictInfo[] = [];
