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
const emotionFilter = document.getElementById('emotion-filter');
const resultsEl = document.getElementById('results');
const resultsMeta = document.getElementById('results-meta');
const activeFiltersEl = document.getElementById('active-filters');
const showMoreBtn = document.getElementById('show-more');
const noResults = document.getElementById('no-results');
const noResultsText = document.getElementById('no-results-text');
const noResultsSuggestions = document.getElementById('no-results-suggestions');
const clarifiersEl = document.getElementById('clarifiers');
const clarifierPrompt = document.getElementById('clarifier-prompt');
const clarifierOptions = document.getElementById('clarifier-options');
const startOver = document.getElementById('start-over');
// The seasonal rail renders server side above the results; it yields to them
// and comes back with the idle state. Absent in test shims, hence the guard.
const seasonRail = document.getElementById('rail-this-season');
// The browse-by-show strip renders server side under the hero; it yields to
// story matches with the rails and returns with the idle state. Absent in
// test shims, hence the guard.
const seriesStrip = document.getElementById('series-strip');

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

// Mobile results paging: the server answer holds the full matched set and the
// view renders it in calm batches. Nothing about this is remembered anywhere;
// it dies with the response.
const RENDER_BATCH = 12;
let fullResults = [];
let renderedCount = 0;

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

// The dropdowns are the one home of the filter state; the guided replies write
// into them, exactly as the age reply always has. Test shims may lack the new
// elements, so the chain fields stand in when they are absent.
function activeEmotion() {
  return emotionFilter ? emotionFilter.value : chain.emotion;
}

function activeSeries() {
  // The Series dropdown is retired; the facet still lives on through the
  // clarifier chips and shared URLs, which write chain.series directly.
  return chain.series;
}

/** The active filters as one row of { facet, value, label }, in dropdown order. */
export function activeFilterChips(age, vibe, emotion, series) {
  const chips = [];
  if (age) chips.push({ facet: 'age', value: age, label: `ages ${age}` });
  if (vibe) chips.push({ facet: 'vibe', value: vibe, label: `vibe: ${vibe}` });
  if (emotion) chips.push({ facet: 'emotion', value: emotion, label: `feeling: ${emotion}` });
  if (series) chips.push({ facet: 'series', value: series, label: `series: ${series}` });
  return chips;
}

/** The live count line: '23 stories match · ages 5-7 · feeling: sad'. */
export function countLine(matched, filters) {
  const noun = matched === 1 ? 'story matches' : 'stories match';
  return [`${matched} ${noun}`, ...activeFilterChips(
    filters.age, filters.vibe, filters.emotion, filters.series,
  ).map((c) => c.label)].join(' · ');
}

/** The warm zero-result sentence: names what the parent asked for. */
export function zeroResultLine(filters) {
  const chips = activeFilterChips(filters.age, filters.vibe, filters.emotion, filters.series);
  return `nothing matches ${chips.map((c) => c.label).join(' + ')}. try removing one filter:`;
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

  // The watch pill names the provider from the row's data: the canonical
  // tv.apple.com web URL is generated at build time (episode level where the
  // id is verified, show page as fallback), and providerLabel is the exact
  // display string, so a future PBS or Disney row needs zero UI rework.
  // Rows with no verified link get no button rather than an invented one.
  if (r.appleUrl) {
    const watch = document.createElement('a');
    watch.className = 'watch';
    watch.href = r.appleUrl;
    watch.target = '_blank';
    watch.rel = 'noopener noreferrer';
    // The play glyph matches the rails' play-logo buttons: the same asset,
    // alt empty so the accessible name stays the aria-label alone.
    const glyph = document.createElement('img');
    glyph.className = 'watch-icon';
    glyph.src = '/play-button.png';
    glyph.alt = '';
    glyph.width = 44;
    glyph.height = 40;
    watch.appendChild(glyph);
    watch.appendChild(document.createTextNode(`Watch on ${r.providerLabel}`));
    // Distinct accessible name per card: a links list of twenty identical
    // "Watch on Apple TV+" entries tells a screen reader user nothing.
    watch.setAttribute('aria-label', `Watch ${r.seriesTitle}, season ${r.seasonNumber} episode ${r.episodeNumber}, on ${r.providerLabel}`);
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
  activeFiltersEl.hidden = true;
  activeFiltersEl.replaceChildren();
  showMoreBtn.hidden = true;
  fullResults = [];
  renderedCount = 0;
  resultsEl.replaceChildren();
  hideClarifiers();
  if (seasonRail) seasonRail.hidden = false;
  if (seriesStrip) seriesStrip.hidden = false;
}

// One chip per active filter, one tap removes it. Mirrors all four dropdowns.
function renderActiveFilters() {
  const chips = activeFilterChips(ageFilter.value, vibeFilter.value, activeEmotion(), activeSeries());
  activeFiltersEl.replaceChildren(...chips.map((c) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip active-filter';
    btn.dataset.facet = c.facet;
    btn.dataset.value = c.value;
    btn.textContent = c.label;
    btn.setAttribute('aria-label', `remove the ${c.label} filter`);
    return btn;
  }));
  activeFiltersEl.hidden = chips.length === 0;
}

// Renders the next calm batch of cards and shows the control only when more
// of the matched set is waiting.
function renderNextBatch() {
  const next = fullResults.slice(renderedCount, renderedCount + RENDER_BATCH);
  renderedCount += next.length;
  for (const r of next) resultsEl.appendChild(renderCard(r));
  showMoreBtn.hidden = renderedCount >= fullResults.length;
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
  const params = chainStateToParams({ ...currentFilters(chain), round: chain.round });
  const qs = params.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

function readUrlState() {
  if (typeof location === 'undefined') return null;
  return parseChainState(new URLSearchParams(location.search));
}

function renderClarifiers(data) {
  const matched = typeof data.matched === 'number' ? data.matched : data.count;
  const options = deriveClarifiers(data.facets, { ...chain, age: ageFilter.value, emotion: activeEmotion(), series: activeSeries() }, matched);
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

// The filter state as one object, dropdowns first: the count line, the chips,
// and the URL all describe the same thing the search used.
function currentFilters(state) {
  return {
    q: state.q,
    age: ageFilter.value,
    vibe: vibeFilter.value,
    emotion: activeEmotion(),
    series: activeSeries(),
  };
}

async function runSearch(state) {
  const filters = currentFilters(state);
  if (!filters.q.trim() && !(filters.age || filters.vibe || filters.emotion || filters.series)) {
    showIdle();
    writeUrl();
    return;
  }
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q);
  if (filters.age) params.set('age', filters.age);
  if (filters.vibe) params.set('vibe', filters.vibe);
  if (filters.emotion) params.set('emotion', filters.emotion);
  if (filters.series) params.set('series', filters.series);
  // The whole matched set, paged in the view: the server keeps no offset and
  // no state, the way it keeps no log.
  params.set('limit', '600');
  const seq = ++searchSeq;
  resultsMeta.hidden = false;
  resultsMeta.textContent = 'searching...';
  noResults.hidden = true;
  showMoreBtn.hidden = true;
  fullResults = [];
  renderedCount = 0;
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
    const matched = typeof data.matched === 'number' ? data.matched : data.count;
    resultsMeta.textContent = countLine(matched, filters);
    renderActiveFilters();
    if (!matched) {
      // Warm and recoverable: name what the parent asked for and hand the
      // removal chips right back. The suggestion chips stay for text searches.
      noResultsText.textContent = filters.age || filters.vibe || filters.emotion || filters.series
        ? zeroResultLine(filters)
        : '';
      noResultsSuggestions.hidden = Boolean(noResultsText.textContent);
      noResults.hidden = false;
      hideClarifiers();
      if (seasonRail) seasonRail.hidden = false;
      if (seriesStrip) seriesStrip.hidden = false;
      writeUrl();
      return;
    }
    // Results replace the rail as the thing on screen; it returns with the
    // idle state.
    if (seasonRail) seasonRail.hidden = true;
    if (seriesStrip) seriesStrip.hidden = true;
    fullResults = data.results;
    renderNextBatch();
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
  // Clarifier buttons share the chip look but are not situations to search,
  // and active filter chips remove a filter in their own handler above.
  if (!chip || (chip.classList && (chip.classList.contains('clarifier') || chip.classList.contains('active-filter')))) return;
  clearTimeout(liveSearchTimer);
  input.value = chip.dataset.q;
  searchFromText();
});

// A clarifier reply: one facet added, one round spent, the same fused search
// rerun. Each reply moves the visible filter it answers, so the dropdown and
// the chain stay one thing, exactly as the age reply always has.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.clarifier');
  if (!btn) return;
  clearTimeout(liveSearchTimer);
  const facet = btn.dataset.facet;
  const value = btn.dataset.value;
  if (facet === 'age') ageFilter.value = value;
  if (facet === 'emotion') {
    chain.emotion = value;
    if (emotionFilter) emotionFilter.value = value;
  }
  if (facet === 'series') {
    chain.series = value;
  }
  chain.round += 1;
  runSearch(chain);
});

// Filters are the first layer: a change always searches, even before the
// parent has typed anything. Clearing every filter returns the idle state.
[ageFilter, vibeFilter, emotionFilter].filter(Boolean).forEach((el) => {
  el.addEventListener('change', () => {
    runSearch(chain);
  });
});

// One tap on an active filter chip removes that filter and searches again.
// Handled before the common situations chips below, which search by text.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.active-filter');
  if (!btn) return;
  clearTimeout(liveSearchTimer);
  const facet = btn.dataset.facet;
  if (facet === 'age') ageFilter.value = '';
  if (facet === 'vibe') vibeFilter.value = '';
  if (facet === 'emotion') {
    chain.emotion = '';
    if (emotionFilter) emotionFilter.value = '';
  }
  if (facet === 'series') {
    chain.series = '';
  }
  chain.round = 0;
  runSearch(chain);
});

// The way out of the chain, always visible while it is open.
startOver.addEventListener('click', () => {
  clearTimeout(liveSearchTimer);
  input.value = '';
  ageFilter.value = '';
  vibeFilter.value = '';
  if (emotionFilter) emotionFilter.value = '';
  chain = { q: '', emotion: '', age: '', series: '', round: 0 };
  showIdle();
  writeUrl();
});

// Calm paging: one tap renders one more batch of the already fetched set.
showMoreBtn.addEventListener('click', () => {
  renderNextBatch();
});

// The expanded rail card view: one static <dialog>, filled from the tapped
// card's own detail template. Stateless: nothing is stored, nothing is
// fetched; the card already carries its parent-facing fields. Native
// <dialog> gives Esc-to-close and the focus trap; we restore focus to
// whatever opened it.
const railDialog = document.getElementById('rail-card-dialog');
if (railDialog) {
  const railDialogTitle = railDialog.querySelector('#rail-dialog-title');
  const railDialogBody = railDialog.querySelector('.rail-dialog-body');
  const railDialogClose = railDialog.querySelector('.rail-dialog-close');
  let railDialogOpener = null;

  railDialog.addEventListener('close', () => {
    if (railDialogOpener) railDialogOpener.focus();
    railDialogOpener = null;
  });

  // Tapping the backdrop (the dialog element itself) closes, like Esc.
  railDialog.addEventListener('click', (e) => {
    if (e.target === railDialog) railDialog.close();
  });

  if (railDialogClose) railDialogClose.addEventListener('click', () => railDialog.close());

  const openRailCard = (card, opener) => {
    const detail = card.querySelector('template.rail-detail');
    if (!detail || typeof railDialog.showModal !== 'function') return;
    railDialogTitle.textContent = card.querySelector('.rail-title').textContent;
    railDialogBody.replaceChildren(detail.content.cloneNode(true));
    // The watch link clones in with its accessible name, so the dialog
    // itself carries the way out to Apple TV+.
    const watch = card.querySelector('.watch-play');
    if (watch) {
      const actions = document.createElement('div');
      actions.className = 'rail-dialog-actions';
      actions.appendChild(watch.cloneNode(true));
      railDialogBody.appendChild(actions);
    }
    railDialogOpener = opener;
    railDialog.showModal();
  };

  document.addEventListener('click', (e) => {
    // The explicit button is the keyboard path; the card tap is the touch
    // path. Watch links keep their own behavior either way.
    const more = e.target.closest('.rail-card-more');
    if (more) {
      openRailCard(more.closest('.rail-card'), more);
      return;
    }
    const card = e.target.closest('.rail-card');
    if (card && !e.target.closest('a')) openRailCard(card, card);
  });
}

// A search shared by URL (the chain state lives there) restores itself on
// load, facets and round included.
(function restoreFromUrl() {
  const state = readUrlState();
  if (!state) return;
  const hasState = state.q || state.emotion || state.age || state.series;
  if (!hasState) return;
  chain = state;
  input.value = state.q;
  if (state.age) ageFilter.value = state.age;
  if (state.emotion && emotionFilter) emotionFilter.value = state.emotion;
  runSearch(chain);
})();
