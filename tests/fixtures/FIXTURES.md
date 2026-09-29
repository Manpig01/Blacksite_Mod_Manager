# Test fixtures (hermetic harness)

Real sp-mod.com artifacts, fetched 2026-09-18 with UA `BlacksiteModManager/1.0 (+https://sp-mod.com)`.
Every harness references these through `AppContext.BaseDirectory/fixtures` (copied to the test
output by each harness .csproj) — NEVER through /tmp or absolute paths.

| File | True format | Source | Used by |
|---|---|---|---|
| 31.zip | ZIP | mod 31 (Scav Cat Trader) latest release | InstalledSmokeTest B/C, QueueSmokeTest E |
| biggerstash.zip | ZIP | mod 32 (Bigger Stash) latest release | InstalledSmokeTest B |
| commonlib.zip | ZIP (backslash entry paths) | mod 2310 (WTT CommonLib) latest release | InstalledSmokeTest B |
| freecam.zip | **7-Zip** (despite the .zip name — kept verbatim on purpose) | mod 164 (Freecam) latest release | InstalledSmokeTest C/D, QueueSmokeTest E/J |
| medatt.zip | ZIP (SPT/ wrapper) | mod 147 (Medical Attention) latest release | QueueSmokeTest B/D/E/G/H, InstalledSmokeTest C/D |
| qe.zip | ZIP | mod 2106 (Quests Extended) latest release | InstalledSmokeTest D |
| realism.zip | **HTML** — the dead-link response body | `mod/download/1353/spt-realism-mod/0.14.11` (link is dead; serves an error page) | InstalledSmokeTest A |
| svm-synthetic.zip | ZIP | **synthetic structural stand-in** for mod 236 (SVM) — see below | InstalledSmokeTest B |
| voicepatcher.rar | RAR5 | `mod/download/1418/wtt-voice-patcher/1.0.1` | InstalledSmokeTest A/C, QueueSmokeTest E |

**svm-synthetic.zip mapping** (size budget): the real SVM archive (mod 236) is 5.76 MB — over
the 5 MB per-fixture budget — so the repo carries a 1.28 MB stand-in with the **exact same
entry skeleton (33/33 names, same order classes)**: `SPT_Runtime/user/mods/[SVM] Server Value
Modifier/…` wrapper + loose `Greed.exe` payload, same archive kind (ZIP). The tiny config files
(`Loader/loader.json`, `Misc/MOTD.txt`, `Misc/Waves.json`) are the real bytes from the recorded
archive; all bulk payloads (`Greed.exe`, language files, `ServerValueModifier.dll`) are synthetic.
Re-record the real archive (recipe below) only when a test genuinely needs its real bulk content;
live sections download the real 5.7 MB archive from the API anyway.

**Size budget (enforced):** fixtures stay **under 10 MB total** and **under 5 MB per file** —
`run-tests.sh` / `run-tests.ps1` fail the run if either limit is exceeded, and `.gitignore`
blocks the known oversized original (`tests/fixtures/svm.zip`).

`api/*.json` — recorded RAW responses from `https://sp-mod.com/api/v0/` (envelope
`{success, data, links, meta}`), used by SmokeTest §0 as an offline schema contract:

| File | Endpoint |
|---|---|
| spt-versions.json | GET /spt/versions?per_page=50&page=1 (first page of the production client's paginated query) |
| mod-categories.json | GET /mod-categories |
| mod-31.json | GET /mod/31 |
| mod-31-versions.json | GET /mod/31/versions?per_page=50 |
| mods-page.json | GET /mods?per_page=5&sort=-downloads |

Re-record any of these against the live API when investigating schema drift; SmokeTest §0
(deserialization contract) then diffs the models against the fresh shape on the next run.

**Re-record recipe** (UA `BlacksiteModManager/1.0 (+https://sp-mod.com)`; only when a test
genuinely needs fresh real content — live sections always hit the API directly):

```python
import urllib.request, json
UA = {'User-Agent': 'BlacksiteModManager/1.0 (+https://sp-mod.com)'}
def api(path):  # https://sp-mod.com/api/v0/...
    return json.loads(urllib.request.urlopen(urllib.request.Request(
        'https://sp-mod.com/api/v0/' + path, headers=UA), timeout=30).read())
# id → fixture file: 31→31.zip, 32→biggerstash.zip, 164→freecam.zip, 147→medatt.zip,
#                    236→svm.zip (oversized — synthetic stand-in in-repo), 2310→commonlib.zip, 2106→qe.zip
mid, fname = 31, '31.zip'
vs = api(f'mod/{mid}/versions?per_page=50')['data']
vs.sort(key=lambda v: v.get('version', ''), reverse=True)
urllib.request.urlretrieve(vs[0]['link'], 'tests/fixtures/' + fname)  # add UA if the CDN asks
# direct downloads: mod/download/1418/wtt-voice-patcher/1.0.1 → voicepatcher.rar
#                   mod/download/1353/spt-realism-mod/0.14.11 → realism.zip (dead link → HTML, on purpose)
```

Live-network sections in all harnesses are OPT-IN via `BLACKSITE_LIVE_TESTS=1` and are
reported as `[SKIP]` otherwise.
