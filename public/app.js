// Frontend for the Phase 1 skeleton: text-only result cards, no artwork.
// All rendered text lands via textContent, never innerHTML, so catalog data
// can never inject markup.

const form = document.getElementById('search-form');
const input = document.getElementById('search-input');
const ageFilter = document.getElementById('age-filter');
const vibeFilter = document.getElementById('vibe-filter');
const resultsEl = document.getElementById('results');
const resultsMeta = document.getElementById('results-meta');
const noResults = document.getElementById('no-results');

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
  return card;
}

async function runSearch(q) {
  if (!q.trim()) return;
  const params = new URLSearchParams({ q });
  if (ageFilter.value) params.set('age', ageFilter.value);
  if (vibeFilter.value) params.set('vibe', vibeFilter.value);
  resultsMeta.hidden = false;
  resultsMeta.textContent = 'searching...';
  noResults.hidden = true;
  resultsEl.replaceChildren();
  try {
    const res = await fetch(`/api/search?${params}`);
    if (!res.ok) throw new Error(`search failed: ${res.status}`);
    const data = await res.json();
    resultsMeta.textContent = `${data.count} of ${data.storyCount} stories matched · index ${data.version}`;
    if (!data.count) {
      noResults.hidden = false;
      return;
    }
    for (const r of data.results) resultsEl.appendChild(renderCard(r));
  } catch {
    resultsMeta.textContent = 'search is unavailable right now. Try again in a moment.';
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch(input.value);
});

document.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  input.value = chip.dataset.q;
  runSearch(chip.dataset.q);
});

[ageFilter, vibeFilter].forEach((el) => el.addEventListener('change', () => {
  if (input.value.trim()) runSearch(input.value);
}));
