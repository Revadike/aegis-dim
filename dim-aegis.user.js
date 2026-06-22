// ==UserScript==
// @name         DIM Aegis Overlay
// @namespace    Revadike
// @author       Revadike
// @version      1.2.1
// @description  Overlays Aegis weapon tier list data on DIM item popups
// @match        https://app.destinyitemmanager.com/*
// @downloadURL  https://raw.githubusercontent.com/Revadike/aegis-dim/master/dim-aegis.user.js
// @updateURL    https://raw.githubusercontent.com/Revadike/aegis-dim/master/dim-aegis.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      docs.google.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const SHEET_ID = '1JM-0SlxVDAi-C6rGVlLxa-J1WGewEeL8Qvq4htWZHhY';
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const AEGIS_ATTR = 'data-dim-aegis';

  const ALL_TABS = [
    'Autos', 'Bows', 'HCs', 'Pulses', 'Scouts', 'Sidearms', 'SMGs',
    'BGLs', 'Fusions', 'Glaives', 'Shotguns', 'Snipers',
    'Rocket Sidearms', 'Traces', 'HGLs', 'LFRs', 'LMGs', 'Rockets',
    'Swords', 'Other',
  ];

  const ENERGY_TYPES = ['Kinetic', 'Stasis', 'Solar', 'Arc', 'Void', 'Strand'];

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

  const getSheet = async (tab) => {
    if (memCache.has(tab)) return memCache.get(tab);
    const dk = `aegis_data_${tab}`, tk = `aegis_ts_${tab}`;
    const stored = GM_getValue(dk, null);
    if (stored && Date.now() - GM_getValue(tk, 0) < CACHE_TTL) {
      const rows = JSON.parse(stored);
      memCache.set(tab, rows);
      return rows;
    }
    const rows = await fetchSheet(tab);
    GM_setValue(dk, JSON.stringify(rows));
    GM_setValue(tk, Date.now());
    memCache.set(tab, rows);
    return rows;
  };

  const buildIdx = (rows) =>
    Object.fromEntries((rows[0] ?? []).map((col, i) => [col, i]));

  const normName = (s) =>
    (s ?? '').split('\n')[0].trim().toLowerCase();

  /** Strip edition suffixes like "(Adept)" or "(Timelost)" from a weapon name. */
  const stripEdition = (name) =>
    name.replace(/\s*\([^)]+\)\s*$/, '').trim();

  const normFrame = (raw) => {
    if (!raw) return '';
    const overrides = { 'Rapid-Fire Frame': 'Rapid', 'Rapid-Fire': 'Rapid' };
    return overrides[raw] ?? raw.replace(/ Frame$/, '').trim();
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
    const target = normName(name);
    const base = normName(stripEdition(name));
    return rows.slice(1).find((r) => {
      const n = normName(r[ni]);
      return n === target || (base !== target && n === base);
    }) ?? null;
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
      barrel: g('PERKS Barrel'),
      mag: g('Mag'),
      perk1: g('Perk 1'),
      perk2: g('Perk 2'),
      origin: g('Origin Trait'),
      notes: g('ANALYSIS Notes'),
      rank: g('Rank'),
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
   * Fetch all sheet tabs in parallel and return the first one containing the weapon.
   * @param {string} name
   * @param {() => boolean} stale
   * @returns {Promise<{rows: string[][], row: string[], tab: string}|null>}
   */
  const findWeapon = async (name, stale) => {
    const results = await Promise.allSettled(ALL_TABS.map(getSheet));
    if (stale()) return null;
    for (let i = 0; i < ALL_TABS.length; i++) {
      if (results[i].status !== 'fulfilled') continue;
      const row = findRow(results[i].value, name);
      if (row) return { rows: results[i].value, row, tab: ALL_TABS[i] };
    }
    return null;
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

  const fmtPerks = (raw) =>
    (raw ?? '').split('\n').map((s) => s.trim()).filter(Boolean).join(' / ');

  const sectionBox = (title) => {
    const box = aegisEl('div', 'aegis-section');
    box.appendChild(makeEl('div', { className: 'aegis-section-header', textContent: title }));
    return box;
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
      const value = fmtPerks(raw);
      if (!value) continue;
      const row = makeEl('div', { className: 'aegis-row' });
      const lbl = makeEl('span', { className: 'aegis-label', textContent: label });
      lbl.style.width = '48px';
      const val = makeEl('span', { textContent: value });
      val.style.cssText = 'flex:1; overflow-wrap:break-word;';
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
      left.appendChild(makeEl('span', { className: `aegis-sup-name${isSelf ? ' aegis-highlight' : ''}`, textContent: w.name }));
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

    if (!isOverviewActive(popup)) return;

    const info = extractWeaponInfo(popup);
    if (!info?.name) return;

    const found = await findWeapon(info.name, stale);
    if (stale() || !found || !document.contains(popup)) return;

    const idx = buildIdx(found.rows);
    const weapon = rowToWeapon(found.row, idx);
    const sup = findSuperiors(found.rows, weapon);

    injectBadges(popup, weapon);
    injectNote(popup, weapon);
    injectPerksAndSuperiors(popup, weapon, sup, found.tab, info.energy, info.frame);
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
