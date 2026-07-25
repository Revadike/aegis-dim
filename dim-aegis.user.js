// ==UserScript==
// @name         DIM Aegis Overlay
// @namespace    Revadike
// @author       Revadike
// @version      1.4.1
// @description  Overlays Aegis weapon tier list data on DIM item popups
// @match        https://app.destinyitemmanager.com/*
// @match        https://beta.destinyitemmanager.com/*
// @downloadURL  https://raw.githubusercontent.com/Revadike/aegis-dim/master/dim-aegis.user.js
// @updateURL    https://raw.githubusercontent.com/Revadike/aegis-dim/master/dim-aegis.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_info
// @connect      docs.google.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = GM_info?.version || GM_info?.script?.version || '0';
  const SHEET_ID = '1JM-0SlxVDAi-C6rGVlLxa-J1WGewEeL8Qvq4htWZHhY';
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const AEGIS_ATTR = 'data-dim-aegis';

  const ALL_TABS = [
    'Autos', 'Bows', 'HCs', 'Pulses', 'Scouts', 'Sidearms', 'SMGs',
    'BGLs', 'Fusions', 'Glaives', 'Shotguns', 'Snipers',
    'Rocket Sidearms', 'Traces', 'HGLs', 'LFRs', 'LMGs', 'Rockets',
    'Swords', 'Other',
  ];

  const ARCHETYPES_TAB = 'Archetypes';

  const ENERGY_TYPES = ['Kinetic', 'Stasis', 'Solar', 'Arc', 'Void', 'Strand'];

  // Invalidate cached sheet data when script version changes
  if (GM_getValue('aegis_version', null) !== SCRIPT_VERSION) {
    for (const tab of [...ALL_TABS, ARCHETYPES_TAB]) {
      GM_setValue(`aegis_data_${tab}`, null);
      GM_setValue(`aegis_ts_${tab}`, 0);
    }
    GM_setValue('aegis_version', SCRIPT_VERSION);
  }

  GM_addStyle(`
    .aegis-badges {
      display: inline-flex;
      gap: 4px;
      align-items: center;
      vertical-align: middle;
      margin-left: 5px;
    }
    .aegis-badge {
      display: inline-block;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 700;
      line-height: 1.7;
      white-space: nowrap;
    }
    .aegis-badge-tier {
      background: var(--theme-accent-primary, #e8a534);
      color: #000;
    }
    .aegis-badge-rank {
      background: var(--theme-button-bg, #fff3);
      color: var(--theme-text, #fff);
    }
    .aegis-note {
      padding: 3px 8px 3px 10px;
      margin: 2px 0;
      border-left: 2px solid var(--theme-accent-primary, #e8a534);
      color: var(--theme-text-secondary, #aaa);
      font-size: 11px;
      line-height: 1.5;
    }
    .aegis-note strong {
      color: var(--theme-accent-primary, #e8a534);
    }
    .aegis-archetype-note {
      color: var(--theme-text-secondary, #aaa);
      font-size: 11px;
      line-height: 1.4;
      margin-top: 2px;
    }
    .aegis-archetype-anchor {
      display: inline-block;
      position: relative;
      width: 0;
      height: 0;
      line-height: 0;
      font-size: 0;
      vertical-align: middle;
    }
    .aegis-archetype-badge-wrap {
      position: absolute;
      left: 5px;
      top: 50%;
      transform: translateY(-60%);
      white-space: nowrap;
      display: inline-flex;
      gap: 4px;
      align-items: center;
    }
    .item-popup div[class*="ItemPopup-m_desktopPopupBody"] {
      width: 360px !important;
    }
    .aegis-section {
      padding: 5px 8px;
      background: var(--theme-item-popup-panel-bg, #2a2a2a);
      border-radius: 3px;
      margin: 3px 0;
      font-size: 11px;
      line-height: 1.5;
      color: var(--theme-text, #fff);
    }
    .aegis-section-header {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: .05em;
      color: var(--theme-accent-primary, #e8a534);
      text-transform: uppercase;
      margin-bottom: 3px;
    }
    .aegis-row {
      display: flex;
      gap: 4px;
      margin: 1px 0;
    }
    .aegis-label {
      color: var(--theme-text-secondary, #aaa);
      flex-shrink: 0;
      padding-right: 6px;
    }
    .aegis-sup-row {
      display: flex;
      justify-content: space-between;
      gap: 4px;
      margin: 1px 0;
    }
    .aegis-sup-left {
      display: flex;
      gap: 4px;
      overflow: hidden;
      flex: 1;
    }
    .aegis-sup-label {
      color: var(--theme-text-secondary, #aaa);
      width: 105px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex-shrink: 0;
    }
    .aegis-sup-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .aegis-muted {
      color: var(--theme-text-secondary, #aaa);
      flex-shrink: 0;
      white-space: nowrap;
    }
    .aegis-highlight {
      color: var(--theme-accent-primary, #e8a534);
    }
    .aegis-clickable {
      cursor: pointer;
    }
    .aegis-clickable:hover {
      text-decoration: underline;
    }
  `);

  const parseCSV = (rawText) => {
    const text = rawText.replace(/\r\n|\r/g, '\n');
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i], nx = text[i + 1];
      if (inQ) {
        if (c === '"' && nx === '"') { field += '"'; i++; }
        else if (c === '"') inQ = false;
        else field += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else field += c;
      }
    }
    if (row.length || field) { row.push(field); rows.push(row); }
    return rows;
  };

  const fetchSheet = (tab) => new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET',
      url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`,
      timeout: 15000,
      onload: (r) => r.status === 200 ? resolve(parseCSV(r.responseText)) : reject(new Error(`HTTP ${r.status}`)),
      onerror: () => reject(new Error('Network error')),
      ontimeout: () => reject(new Error('Timeout')),
    });
  });

  /** In-memory cache to avoid re-parsing GM storage on every lookup. */
  const memCache = new Map();

  const buildIdx = (rows) =>
    Object.fromEntries((rows[0] ?? []).map((col, i) => [col, i]));

  const normName = (s) =>
    (s ?? '').split('\n')[0].trim().toLowerCase();

  const canonicalWeaponKey = (name) =>
    normName(stripEdition((name ?? '').split('\n')[0].trim()));

  /** Strip edition suffixes like "(Adept)" or "(Timelost)" from a weapon name. */
  const stripEdition = (name) =>
    name.replace(/\s*\([^)]+\)\s*$/, '').trim();

  const normFrame = (raw) => {
    if (!raw) return '';
    const overrides = { 'Rapid-Fire Frame': 'Rapid', 'Rapid-Fire': 'Rapid' };
    return overrides[raw] ?? raw.replace(/ Frame$/, '').trim();
  };

  /**
   * DIM weapon-type labels that don't literally match the Archetypes sheet's
   * "Weapon" column and need an explicit rename before comparison.
   */
  const WEAPON_TYPE_ALIASES = {
    'combat bow': 'bow',
    'submachine gun': 'smg',
  };

  /**
   * Normalize a weapon-type string for comparison against the Archetypes sheet:
   * lowercase + trim, apply known DIM->sheet renames, and drop a trailing
   * " - <loading style>" qualifier (e.g. sheet's "Grenade launcher - breech" /
   * "- drum" both collapse to "grenade launcher", matching DIM's single
   * "Grenade Launcher" type - loading style is disambiguated via the frame instead).
   */
  const normWeaponType = (s) => {
    let key = (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    key = key.replace(/\s+-\s+.*$/, '');
    return WEAPON_TYPE_ALIASES[key] ?? key;
  };

  /**
   * Normalize an archetype/frame name for comparison against the Archetypes sheet:
   * - keep only the first line (the sheet sometimes has an irrelevant 2nd line,
   *   e.g. "High-Impact\nHeavy Bolts" or "Adaptive\nPack Hunter")
   * - strip bracketed/parenthetical suffixes, e.g. "Disruption Weapon [Shield-Piercing]"
   * - strip filler words DIM/the sheet append inconsistently: "frame", "heat",
   *   "weapon", "glaive", "sword" (e.g. "Dynamic Heat Weapon" -> "Dynamic",
   *   "Wave Sword Frame" -> "Wave", "Aggressive Glaive" -> "Aggressive")
   * - normalize hyphens to spaces so "Rapid-Fire" and "Rapid Fire" match
   * - collapse whitespace, trim, lowercase
   * e.g. "Lightweight Frame" -> "lightweight", "High-Impact\nHeavy Bolts" -> "high impact"
   */
  const normFrameName = (s) => {
    let v = (s ?? '').split('\n')[0] ?? '';
    v = v.replace(/\[[^\]]*\]/g, ' ');
    v = v.replace(/\([^)]*\)/g, ' ');
    v = v.replace(/\b(frame|heat|weapon|glaive|sword)\b/gi, ' ');
    v = v.replace(/-/g, ' ');
    return v.replace(/\s+/g, ' ').trim().toLowerCase();
  };

  /**
   * Get a column value by trying multiple possible column name variants.
   * Handles sheets where headers differ (e.g. "Perk 1" vs "PERKS Perk 1").
   * @param {string[]} row
   * @param {Record<string,number>} idx
   * @param {...string} keys
   * @returns {string}
   */
  const getCol = (row, idx, ...keys) => {
    for (const k of keys) {
      if (idx[k] !== undefined) return (row[idx[k]] ?? '').trim();
    }
    return '';
  };

  /** Rank as a number; Infinity when the cell is blank. */
  const getRowRank = (row, idx) => {
    const s = (row[idx['\#']] ?? '').trim();
    return s ? Number(s) : Infinity;
  };

  /**
   * Score a row by how many of the key perk/analysis fields are filled.
   * Used as a tiebreaker when ranks are equal.
   */
  const getRowEssentialScore = (row, idx) => {
    return [
      getCol(row, idx, 'Perk 1', 'PERKS Perk 1'),
      (row[idx['Perk 2']] ?? '').trim(),
      (row[idx['Origin Trait']] ?? '').trim(),
      (row[idx['ANALYSIS Notes']] ?? '').trim(),
      (row[idx['Tier']] ?? '').trim(),
    ].filter(Boolean).length;
  };

  /**
   * Returns true if candidateRow should replace currentRow.
   * Primary: more essential fields filled. Secondary: lower rank number.
   * @param {string[]} candidateRow
   * @param {Record<string,number>} candidateIdx
   * @param {string[]} currentRow
   * @param {Record<string,number>} currentIdx
   */
  const isBetterRow = (candidateRow, candidateIdx, currentRow, currentIdx) => {
    const cs = getRowEssentialScore(candidateRow, candidateIdx);
    const es = getRowEssentialScore(currentRow, currentIdx);
    if (cs !== es) return cs > es;
    return getRowRank(candidateRow, candidateIdx) < getRowRank(currentRow, currentIdx);
  };

  /**
   * Deduplicate rows within a sheet by base weapon name, merging complementary entries.
   * Rows are sorted by rank (ascending, unranked last), then fields are filled in from
   * subsequent rows wherever the base row has an empty cell. This handles the common
   * pattern where one entry has rank/tier and another has the actual perk data.
   * Sheets without a "Name" column (e.g. Archetypes) are returned unchanged.
   * @param {string[][]} rows
   * @returns {string[][]}
   */
  const preprocessRows = (rows) => {
    if (!rows || rows.length < 2) return rows;
    const idx = buildIdx(rows);
    const ni = idx['Name'];
    if (ni === undefined) return rows;

    const groups = new Map();
    for (const row of rows.slice(1)) {
      const rawName = (row[ni] ?? '').trim();
      if (!rawName) continue;
      const key = canonicalWeaponKey(rawName);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }

    const merged = [];
    for (const group of groups.values()) {
      // Put ranked rows first so rank/tier come from the canonical entry
      const sorted = [...group].sort((a, b) => getRowRank(a, idx) - getRowRank(b, idx));
      const base = [...sorted[0]];
      for (let i = 1; i < sorted.length; i++) {
        const other = sorted[i];
        const len = Math.max(base.length, other.length);
        for (let col = 0; col < len; col++) {
          if (!(base[col] ?? '').trim() && (other[col] ?? '').trim()) {
            base[col] = other[col];
          }
        }
      }
      merged.push(base);
    }

    return [rows[0], ...merged];
  };

  const getSheet = async (tab) => {
    if (memCache.has(tab)) return memCache.get(tab);
    const dk = `aegis_data_${tab}`, tk = `aegis_ts_${tab}`;
    const stored = GM_getValue(dk, null);
    if (stored && Date.now() - GM_getValue(tk, 0) < CACHE_TTL) {
      const rows = JSON.parse(stored);
      memCache.set(tab, rows);
      return rows;
    }
    const rawRows = await fetchSheet(tab);
    const rows = preprocessRows(rawRows);
    GM_setValue(dk, JSON.stringify(rows));
    GM_setValue(tk, Date.now());
    memCache.set(tab, rows);
    return rows;
  };

  /**
   * Find a data row matching the weapon name, also trying without edition suffix.
   * @param {string[][]} rows
   * @param {string} name
   * @returns {string[]|null}
   */
  const findRow = (rows, name) => {
    if (!rows || rows.length < 2) return null;
    const idx = buildIdx(rows);
    const ni = idx['Name'];
    if (ni === undefined) return null;
    const target = canonicalWeaponKey(name);
    const matches = rows.slice(1).filter((r) => canonicalWeaponKey(r[ni]) === target);
    if (!matches.length) return null;
    return matches.reduce((best, row) =>
      isBetterRow(row, idx, best, idx) ? row : best
    );
  };

  /**
   * Find the Archetypes sheet row matching both weapon type and frame archetype.
   * Weapon type is compared lowercase/trimmed; frame is compared with the word
   * "frame" stripped, newlines collapsed to spaces, then lowercase/trimmed.
   * @param {string[][]} rows
   * @param {Record<string,number>} idx
   * @param {string} weaponType
   * @param {string} frameName
   * @returns {string[]|null}
   */
  const findArchetypeRow = (rows, idx, weaponType, frameName) => {
    if (!rows || rows.length < 2) return null;
    const wi = idx['Weapon'], fi = idx['Frame'];
    if (wi === undefined || fi === undefined) return null;
    const targetWeapon = normWeaponType(weaponType);
    const targetFrame = normFrameName(frameName);
    if (!targetWeapon || !targetFrame) return null;
    return rows.slice(1).find((r) =>
      normWeaponType(r[wi]) === targetWeapon && normFrameName(r[fi]) === targetFrame
    ) ?? null;
  };

  /**
   * @param {string[]} row
   * @param {Record<string,number>} idx
   * @returns {object}
   */
  const rowToWeapon = (row, idx) => {
    const g = (k) => (row[idx[k]] ?? '').trim();
    return {
      name: g('Name').split('\n')[0].trim(),
      energy: g('Energy'),
      frame: g('Frame'),
      barrel: getCol(row, idx, 'PERKS Barrel', 'Barrel'),
      mag: g('Mag'),
      perk1: getCol(row, idx, 'Perk 1', 'PERKS Perk 1'),
      perk2: g('Perk 2'),
      origin: g('Origin Trait'),
      notes: g('ANALYSIS Notes'),
      rank: g('\#'),
      tier: g('Tier'),
    };
  };

  /**
   * Find the best weapons (lowest rank) sharing energy type, frame archetype, or both.
   * @param {string[][]} rows
   * @param {{ energy: string, frame: string }} current
   */
  const findSuperiors = (rows, current) => {
    const idx = buildIdx(rows);
    const all = rows.slice(1)
      .filter((r) => r[idx['Name']]?.trim())
      .map((r) => rowToWeapon(r, idx))
      .sort((a, b) => Number(a.rank) - Number(b.rank));
    return {
      byEnergy: all.find((w) => w.energy === current.energy),
      byFrame: all.find((w) => w.frame === current.frame),
      byBoth: all.find((w) => w.energy === current.energy && w.frame === current.frame),
    };
  };

  /**
   * Fetch all sheet tabs in parallel and return the best match across all tabs.
   * Handles weapons that appear in multiple tabs (e.g. High Albedo in Sidearms + Rocket Sidearms).
   * @param {string} name
   * @param {() => boolean} stale
   * @returns {Promise<{rows: string[][], row: string[], tab: string}|null>}
   */
  const findWeapon = async (name, stale) => {
    const results = await Promise.allSettled(ALL_TABS.map(getSheet));
    if (stale()) return null;
    let best = null;
    for (let i = 0; i < ALL_TABS.length; i++) {
      if (results[i].status !== 'fulfilled') continue;
      const rows = results[i].value;
      const row = findRow(rows, name);
      if (!row) continue;
      const idx = buildIdx(rows);
      if (!best || isBetterRow(row, idx, best.row, buildIdx(best.rows))) {
        best = { rows, row, tab: ALL_TABS[i] };
      }
    }
    return best;
  };

  /**
   * Extract the weapon name, energy type, and frame archetype from the popup DOM.
   * @param {Element} popup
   * @returns {{ name: string, energy: string|null, frame: string|null }|null}
   */
  const extractWeaponInfo = (popup) => {
    const name = popup.querySelector('h1 span')?.textContent?.trim();
    if (!name) return null;

    let energy = null;
    for (const e of ENERGY_TYPES) {
      if (popup.querySelector(`[title="${e}"]`)) { energy = e; break; }
    }

    let frame = null;
    const perksBtn = popup.querySelector('button[title^="Display perks"]');
    const frameRow = perksBtn?.parentElement?.previousElementSibling;
    if (frameRow) {
      const textDiv = [...frameRow.children].find(
        (c) => !c.querySelector('.item-img') && !c.querySelector('img')
      );
      if (textDiv) {
        const leaf = [...textDiv.querySelectorAll('div')].find(
          (d) => !d.children.length && d.textContent.trim()
        );
        frame = normFrame(leaf?.textContent.trim() ?? textDiv.textContent.trim());
      }
    }

    return { name, energy, frame };
  };

  /**
   * Extract the weapon type label and archetype/frame name+element used to
   * look up the Archetypes sheet (Weapon + Frame columns).
   * @param {Element} popup
   * @returns {{ weaponType: string, frameName: string, nameEl: Element }|null}
   */
  const extractArchetypeInfo = (popup) => {
    const typeEl = popup.querySelector('div[class*="itemType"]');
    const nameEl = popup.querySelector('div[class*="ArchetypeSocket-m_name"]');
    if (!typeEl || !nameEl) return null;
    const weaponType = typeEl.textContent?.trim() ?? '';
    const frameName = nameEl.textContent?.trim() ?? '';
    if (!weaponType || !frameName) return null;
    return { weaponType, frameName, nameEl };
  };

  /**
   * Returns true when the Overview tab is active, or there are no tabs.
   * @param {Element} popup
   */
  const isOverviewActive = (popup) => {
    const activeTab = popup.querySelector('[role="tab"][aria-selected="true"]');
    return activeTab ? (activeTab.textContent?.includes('Overview') ?? false) : true;
  };

  const makeEl = (tag, props = {}) => Object.assign(document.createElement(tag), props);

  /**
   * Create a top-level injected element marked with the aegis cleanup attribute.
   * @param {string} tag
   * @param {string} [className]
   */
  const aegisEl = (tag, className = '') => {
    const el = document.createElement(tag);
    el.setAttribute(AEGIS_ATTR, '1');
    if (className) el.className = className;
    return el;
  };

  const sectionBox = (title) => {
    const box = aegisEl('div', 'aegis-section');
    box.appendChild(makeEl('div', { className: 'aegis-section-header', textContent: title }));
    return box;
  };

  /**
   * Update DIM's filter input in a React-compatible way.
   * @param {string} query
   */
  const setSearch = (query) => {
    const input = document.querySelector('input[name="filter"]');
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, query);
    else input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus();
  };

  /**
   * Render a newline-separated perk string as individually clickable spans.
   * Each span fires exactperk:"<name>" in the DIM search bar on click.
   * @param {string} raw
   * @returns {DocumentFragment}
   */
  const renderPerkSpans = (raw) => {
    const perks = (raw ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
    const frag = document.createDocumentFragment();
    perks.forEach((perk, i) => {
      if (i > 0) frag.appendChild(document.createTextNode(' / '));
      const span = document.createElement('span');
      span.textContent = perk;
      span.className = 'aegis-clickable';
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        setSearch(`exactperk:"${perk}"`);
      });
      frag.appendChild(span);
    });
    return frag;
  };

  /**
   * Inject tier and rank badges after the ammo icon in the weapon-type row.
   * @param {Element} popup
   * @param {{ tier: string, rank: string }} weapon
   */
  const injectBadges = (popup, weapon) => {
    const hdrBtn = popup.querySelector('h1')?.closest('button');
    const ammoIcon = hdrBtn?.querySelector('img[src^="data:image/svg+xml"]');
    if (!ammoIcon) return;

    const wrap = aegisEl('span', 'aegis-badges');
    wrap.appendChild(makeEl('span', { className: 'aegis-badge aegis-badge-tier', textContent: `${weapon.tier}-tier` }));
    wrap.appendChild(makeEl('span', { className: 'aegis-badge aegis-badge-rank', textContent: `#${weapon.rank}` }));
    ammoIcon.after(wrap);
  };

  /**
   * Inject the Aegis analysis note after the masterwork/crafted-weapon progress row.
   * @param {Element} popup
   * @param {{ notes: string }} weapon
   */
  const injectNote = (popup, weapon) => {
    if (!weapon.notes) return;
    const anchor = popup.querySelector('[role="tabpanel"] > div:first-child');
    if (!anchor) return;
    const div = aegisEl('div', 'aegis-note');
    div.appendChild(makeEl('strong', { textContent: 'Aegis: ' }));
    div.appendChild(document.createTextNode(weapon.notes));
    anchor.after(div);
  };

  /**
   * Inject the recommended-perks and best-in-category sections after the perk sockets.
   * @param {Element} popup
   * @param {object} weapon
   * @param {{ byEnergy?: object, byFrame?: object, byBoth?: object }} sup
   * @param {string} tab - Aegis sheet tab name used as category label
   * @param {string|null} energy
   * @param {string|null} frame
   */
  const injectPerksAndSuperiors = (popup, weapon, sup, tab, energy, frame) => {
    const perksBtn = popup.querySelector('button[title^="Display perks"]');
    const perksSection = perksBtn?.parentElement;
    if (!perksSection) return;

    const perksBox = sectionBox('Aegis Recommended Perks');
    for (const [label, raw] of [
      ['Barrel', weapon.barrel],
      ['Mag', weapon.mag],
      ['Perk 1', weapon.perk1],
      ['Perk 2', weapon.perk2],
      ['Origin', weapon.origin],
    ]) {
      const perks = (raw ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
      if (!perks.length) continue;
      const row = makeEl('div', { className: 'aegis-row' });
      const lbl = makeEl('span', { className: 'aegis-label', textContent: label });
      lbl.style.width = '48px';
      const val = makeEl('span');
      val.style.cssText = 'flex:1; overflow-wrap:break-word;';
      val.appendChild(renderPerkSpans(raw));
      row.appendChild(lbl);
      row.appendChild(val);
      perksBox.appendChild(row);
    }

    const supBox = sectionBox(`Best in ${tab}`);
    const addSupEntry = (labelText, w) => {
      if (!w) return;
      const isSelf = normName(w.name) === normName(weapon.name);
      const row = makeEl('div', { className: 'aegis-sup-row' });
      const left = makeEl('span', { className: 'aegis-sup-left' });
      left.appendChild(makeEl('span', { className: 'aegis-sup-label', textContent: labelText }));
      const nameEl = makeEl('span', {
        className: `aegis-sup-name aegis-clickable${isSelf ? ' aegis-highlight' : ''}`,
        textContent: w.name,
      });
      nameEl.addEventListener('click', (e) => {
        e.stopPropagation();
        setSearch(`exactname:"${w.name}"`);
      });
      left.appendChild(nameEl);
      row.appendChild(left);
      row.appendChild(makeEl('span', { className: 'aegis-muted', textContent: `${w.tier} #${w.rank}` }));
      supBox.appendChild(row);
    };

    if (energy) addSupEntry(energy, sup.byEnergy);
    if (frame) addSupEntry(frame, sup.byFrame);
    if (energy && frame) addSupEntry(`${energy}/${frame}`, sup.byBoth);

    perksSection.after(perksBox);
    if (supBox.children.length > 1) perksBox.after(supBox);
  };

  /**
   * Inject the archetype tier chip next to the archetype/frame name, and replace
   * the rpm/impact stats line with the Aegis analysis notes for that archetype.
   * @param {{ nameEl: Element }} archInfo
   * @param {string[]} row - Matched Archetypes sheet row
   * @param {Record<string,number>} idx - Archetypes sheet column index
   */
  const injectArchetypeOverlay = (archInfo, row, idx) => {
    const { nameEl } = archInfo;
    const tier = (row[idx['Tier']] ?? '').trim();
    const notes = (row[idx['ANALYSIS Notes']] ?? '').trim();

    if (tier) {
      // A zero-size, zero-line-height anchor holds the actual badge out of
      // flow via absolute positioning, so it sits right after the name text
      // (same size/alignment/position as before) without growing the line box.
      const anchor = aegisEl('span', 'aegis-archetype-anchor');
      const chipWrap = makeEl('span', { className: 'aegis-archetype-badge-wrap' });
      chipWrap.appendChild(makeEl('span', { className: 'aegis-badge aegis-badge-tier', textContent: `${tier}-tier` }));
      anchor.appendChild(chipWrap);
      nameEl.appendChild(anchor);
      nameEl.style.overflow = 'visible';
    }

    const infoContainer = nameEl.parentElement;
    if (!infoContainer) return;

    // Remove the existing "450 rpm / 27 impact" style stats line, if present
    const statsEl = infoContainer.querySelector('div[class*="ItemSocketsWeapons-m_stats"]');
    statsEl?.remove();

    if (notes) {
      const noteEl = aegisEl('div', 'aegis-archetype-note');
      noteEl.textContent = notes;
      infoContainer.appendChild(noteEl);
    }
  };

  /**
   * Translate the tabpanel container up if the popup extends below the viewport.
   * Resets any previous transform before measuring so calculations are accurate.
   * @param {Element} popup
   */
  const adjustPopupPosition = (popup) => {
    const tabpanel = popup.querySelector('[role="tabpanel"]');
    if (!tabpanel) return;
    const container = tabpanel.parentNode;
    if (!(container instanceof HTMLElement)) return;
    container.style.transform = '';
    requestAnimationFrame(() => {
      const overflow = popup.getBoundingClientRect().bottom - window.innerHeight;
      if (overflow > 0) {
        container.style.transform = `translateY(-${overflow}px)`;
      }
    });
  };

  const triggerMap = new WeakMap();

  /**
   * Fetch Aegis data for the weapon in the popup and inject overlay elements.
   * Only runs when the Overview tab is active.
   * @param {Element} popup
   */
  const processPopup = async (popup) => {
    const tid = (triggerMap.get(popup) ?? 0) + 1;
    triggerMap.set(popup, tid);
    const stale = () => triggerMap.get(popup) !== tid;

    popup.querySelectorAll(`[${AEGIS_ATTR}]`).forEach((el) => el.remove());
    // Reset any position transform from a previous injection
    const prevTabpanel = popup.querySelector('[role="tabpanel"]');
    if (prevTabpanel?.parentNode instanceof HTMLElement) {
      prevTabpanel.parentNode.style.transform = '';
    }

    if (!isOverviewActive(popup)) return;

    const info = extractWeaponInfo(popup);
    const archInfo = extractArchetypeInfo(popup);

    const [found, archRows] = await Promise.all([
      info?.name ? findWeapon(info.name, stale) : Promise.resolve(null),
      archInfo ? getSheet(ARCHETYPES_TAB).catch(() => null) : Promise.resolve(null),
    ]);

    if (stale() || !document.contains(popup)) return;

    if (found) {
      const idx = buildIdx(found.rows);
      const weapon = rowToWeapon(found.row, idx);
      const sup = findSuperiors(found.rows, weapon);

      injectBadges(popup, weapon);
      injectNote(popup, weapon);
      injectPerksAndSuperiors(popup, weapon, sup, found.tab, info.energy, info.frame);
    }

    if (archInfo && archRows) {
      const archIdx = buildIdx(archRows);
      const archRow = findArchetypeRow(archRows, archIdx, archInfo.weaponType, archInfo.frameName);
      if (archRow) injectArchetypeOverlay(archInfo, archRow, archIdx);
    }

    adjustPopupPosition(popup);
  };

  let contentObs = null, debounceTimer = null;

  /**
   * Attach a mutation observer that re-runs processPopup when the weapon changes
   * or when the Overview tab is re-shown after a tab switch.
   * @param {Element} popup
   */
  const watchPopupContent = (popup) => {
    contentObs?.disconnect();
    let lastName = popup.querySelector('h1 span')?.textContent?.trim() ?? '';

    contentObs = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (!isOverviewActive(popup)) return;
        const cur = popup.querySelector('h1 span')?.textContent?.trim() ?? '';
        if (!cur) return;
        if (cur !== lastName || !popup.querySelector(`[${AEGIS_ATTR}]`)) {
          lastName = cur;
          processPopup(popup);
        }
      }, 150);
    });

    contentObs.observe(popup, { childList: true, subtree: true });
  };

  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const popup = node.classList?.contains('item-popup')
          ? node
          : node.querySelector?.('.item-popup');
        if (popup) {
          watchPopupContent(popup);
          processPopup(popup);
        }
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

})();