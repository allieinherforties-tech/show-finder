// Frontend for the kid situation finder: text and artwork result cards, live
// search, and the guided reply chain. All rendered text lands via
// textContent, never innerHTML, so catalog data can never inject markup.

import {
  MAX_ROUNDS,
  deriveClarifiers,
  parseChainState,
  chainStateToParams,
  chainPrompt,
} from './guided-replies.js';

const form = document.getElementById('search-form');
const input = document.getElementById('search-input');
const ageFilter = document.getElementById('age-filter');
const vibeFilter = document.getElementById('vibe-filter');
const resultsEl = document.getElementById('results');
const resultsMeta = document.getElementById('results-meta');
const noResults = document.getElementById('no-results');
const clarifiersEl = document.getElementById('clarifiers');
const clarifierPrompt = document.getElementById('clarifier-prompt');
const clarifierOptions = document.getElementById('clarifier-options');
const startOver = document.getElementById('start-over');
// The seasonal rail renders server side above the results; it yields to them
// and comes back with the idle state. Absent in test shims, hence the guard.
const seasonRail = document.getElementById('rail-this-season');

// Live search waits for a pause in typing before hitting the API, and a
// sequence number drops stale responses: a slow reply for an earlier query
// must never overwrite fresh results.
const LIVE_SEARCH_DEBOUNCE_MS = 300;
let liveSearchTimer;
let searchSeq = 0;

// Artwork mode comes from the server with every search response. The default
// is off until the server says otherwise, so a text mode deploy renders no
// images at all. This flag is the swappable artwork layer: one deploy change.
let artworkMode = 'text';

// Guided reply chain state. The URL is the only place this lives: no
// localStorage, no cookies, nothing server side. A reply adds one facet and
// bumps the round; typing free text starts a fresh chain.
let chain = { q: '', emotion: '', age: '', series: '', round: 0 };

function episodeLabel(r) {
  const seg = r.segmentTitle ? ` · ${r.segmentTitle}` : '';
  return `S${r.seasonNumber} E${r.episodeNumber}${seg}`;
}

function tagLine(r) {
  const parts = [];
  if (r.ageBand) parts.push(`ages ${r.ageBand.replace('-', ' to ')}`);
  if (r.vibe) parts.push(r.vibe);
  if (r.emotions.length) parts.push(r.emotions.join(', '));
  return parts.join(' · ');
}

function renderCard(r) {
  const card = document.createElement('article');
  card.className = 'card';

  if (artworkMode === 'tmdb') {
    // TMDB hotlink, original aspect ratio preserved: no crop, no filter, no
    // overlay, per the Artwork Terms Findings. Still first, series poster
    // second, text-only card when the row has neither.
    const src = r.stillUrl || r.posterUrl;
    if (src) {
      const figure = document.createElement('figure');
      figure.className = 'card-artwork';
      const img = document.createElement('img');
      img.className = 'card-image';
      img.loading = 'lazy';
      img.src = src;
      const kind = r.stillUrl ? 'Episode still' : 'Series poster';
      img.alt = `${kind} for ${r.seriesTitle}`;
      figure.appendChild(img);
      card.appendChild(figure);
    }
  }

  const heading = document.createElement('h3');
  heading.textContent = r.seriesTitle;

  const episode = document.createElement('p');
  episode.className = 'episode';
  episode.textContent = episodeLabel(r);

  const situation = document.createElement('p');
  situation.className = 'situation';
  situation.textContent = r.situation;

  const synopsis = document.createElement('p');
  synopsis.className = 'synopsis';
  synopsis.textContent = r.displaySynopsis;

  const tags = document.createElement('p');
  tags.className = 'tags';
  const tagsText = tagLine(r);
  tags.textContent = tagsText;

  const resolution = document.createElement('p');
  resolution.className = 'resolution';
  if (r.coping) {
    const label = document.createElement('span');
    label.className = 'resolution-label';
    label.textContent = 'resolution: ';
    resolution.appendChild(label);
    resolution.appendChild(document.createTextNode(r.coping));
  }

  card.append(heading, episode, tagsText ? tags : '', situation, synopsis, resolution);

  // Watch on Apple TV+: the canonical tv.apple.com web URL generated at build
  // time (episode level where the id is verified, show page as fallback).
  // Rows with no verified link get no button rather than an invented one.
  if (r.appleUrl) {
    const watch = document.createElement('a');
    watch.className = 'watch';
    watch.href = r.appleUrl;
    watch.target = '_blank';
    watch.rel = 'noopener noreferrer';
    watch.textContent = 'Watch on Apple TV+';
    // Distinct accessible name per card: a links list of twenty identical
    // "Watch on Apple TV+" entries tells a screen reader user nothing.
    watch.setAttribute('aria-label', `Watch ${r.seriesTitle}, season ${r.seasonNumber} episode ${r.episodeNumber}, on Apple TV+`);
    card.appendChild(watch);
  }

  return card;
}

// The calm idle state: rails and chips only, no stale results left over
// from the previous query.
function showIdle() {
  resultsMeta.hidden = true;
  resultsMeta.textContent = '';
  noResults.hidden = true;
  resultsEl.replaceChildren();
  hideClarifiers();
  if (seasonRail) seasonRail.hidden = false;
}

function hideClarifiers() {
  clarifiersEl.hidden = true;
  clarifierPrompt.textContent = '';
  clarifierOptions.replaceChildren();
  startOver.hidden = true;
}

// URL parameters are the chain's only memory. history may be absent (tests,
// non-browser), in which case the state simply is not written anywhere.
function writeUrl() {
  if (typeof history === 'undefined' || !history.replaceState || typeof location === 'undefined') return;
  const params = chainStateToParams({ ...chain, age: ageFilter.value });
  const qs = params.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

function readUrlState() {
  if (typeof location === 'undefined') return null;
  return parseChainState(new URLSearchParams(location.search));
}

function renderClarifiers(data) {
  const matched = typeof data.matched === 'number' ? data.matched : data.count;
  const options = deriveClarifiers(data.facets, { ...chain, age: ageFilter.value }, matched);
  if (!options.length) {
    // After the last round the chain is done; leave the exit control only.
    if (chain.round > 0 && chain.round >= MAX_ROUNDS) {
      clarifierPrompt.textContent = '';
      clarifierOptions.replaceChildren();
      startOver.hidden = false;
      clarifiersEl.hidden = false;
    } else {
      hideClarifiers();
    }
    return;
  }
  clarifierPrompt.textContent = chainPrompt(chain.round);
  clarifierOptions.replaceChildren(
    ...options.map((o) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip clarifier';
      btn.dataset.facet = o.facet;
      btn.dataset.value = o.value;
      btn.textContent = o.label;
      return btn;
    }),
  );
  startOver.hidden = false;
  clarifiersEl.hidden = false;
}

// A filter or guided facet is a selection even without typed text: the
// parent is browsing the catalog, and that is a real search.
function hasFilterSelection(state) {
  return Boolean(ageFilter.value || vibeFilter.value || state.emotion || state.series);
}

async function runSearch(state) {
  if (!state.q.trim() && !hasFilterSelection(state)) {
    showIdle();
    writeUrl();
    return;
  }
  const params = new URLSearchParams();
  if (state.q.trim()) params.set('q', state.q);
  if (ageFilter.value) params.set('age', ageFilter.value);
  if (vibeFilter.value) params.set('vibe', vibeFilter.value);
  if (state.emotion) params.set('emotion', state.emotion);
  if (state.series) params.set('series', state.series);
  const seq = ++searchSeq;
  resultsMeta.hidden = false;
  resultsMeta.textContent = 'searching...';
  noResults.hidden = true;
  resultsEl.replaceChildren();
  hideClarifiers();
  try {
    const res = await fetch(`/api/search?${params}`);
    if (!res.ok) throw new Error(`search failed: ${res.status}`);
    const data = await res.json();
    // The swappable artwork layer: the server reports its mode on every
    // search, so a text mode deploy renders no images at all.
    artworkMode = data.artworkMode === 'text' ? 'text' : 'tmdb';
    if (seq !== searchSeq) return;
    resultsMeta.textContent = `${data.count} of ${data.storyCount} stories matched · index ${data.version}`;
    if (!data.count) {
      noResults.hidden = false;
      hideClarifiers();
      if (seasonRail) seasonRail.hidden = false;
      writeUrl();
      return;
    }
    // Results replace the rail as the thing on screen; it returns with the
    // idle state.
    if (seasonRail) seasonRail.hidden = true;
    for (const r of data.results) resultsEl.appendChild(renderCard(r));
    renderClarifiers(data);
    writeUrl();
  } catch (err) {
    if (seq !== searchSeq) return;
    console.error('search failed:', err);
    resultsMeta.textContent = 'search is unavailable right now. Try again in a moment.';
  }
}

// A new typed query outranks the chain: facets clear, the round count resets,
// the age select keeps whatever the parent chose.
function searchFromText() {
  chain = { q: input.value, emotion: '', age: '', series: '', round: 0 };
  runSearch(chain);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  clearTimeout(liveSearchTimer);
  searchFromText();
});

// Live search: rerun the same fused search while the parent types, updating
// results in place. Typing always wins over the chain mid step: it starts a
// fresh one. Submit and chips stay as alternate triggers.
input.addEventListener('input', () => {
  clearTimeout(liveSearchTimer);
  liveSearchTimer = setTimeout(searchFromText, LIVE_SEARCH_DEBOUNCE_MS);
});

document.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  // Clarifier buttons share the chip look but are not situations to search.
  if (!chip || (chip.classList && chip.classList.contains('clarifier'))) return;
  clearTimeout(liveSearchTimer);
  input.value = chip.dataset.q;
  searchFromText();
});

// A clarifier reply: one facet added, one round spent, the same fused search
// rerun. The age reply also moves the visible filter so the two stay one.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.clarifier');
  if (!btn) return;
  clearTimeout(liveSearchTimer);
  const facet = btn.dataset.facet;
  const value = btn.dataset.value;
  if (facet === 'age') ageFilter.value = value;
  if (facet === 'emotion') chain.emotion = value;
  if (facet === 'series') chain.series = value;
  chain.round += 1;
  runSearch(chain);
});

// Filters are the first layer: a change always searches, even before the
// parent has typed anything. Clearing every filter returns the idle state.
[ageFilter, vibeFilter].forEach((el) => el.addEventListener('change', () => {
  runSearch(chain);
}));

// The way out of the chain, always visible while it is open.
startOver.addEventListener('click', () => {
  clearTimeout(liveSearchTimer);
  input.value = '';
  ageFilter.value = '';
  vibeFilter.value = '';
  chain = { q: '', emotion: '', age: '', series: '', round: 0 };
  showIdle();
  writeUrl();
});

// A search shared by URL (the chain state lives there) restores itself on
// load, facets and round included.
(function restoreFromUrl() {
  const state = readUrlState();
  if (!state || !state.q) return;
  chain = state;
  input.value = state.q;
  if (state.age) ageFilter.value = state.age;
  runSearch(chain);
})();
