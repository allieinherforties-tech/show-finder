// The Q4 holiday rail: one featured seasonal moment (Christmas lead) with
// Thanksgiving and Winter as labeled secondary shelves. New Year is dropped
// per the depth ruling and ships nowhere.
//
// Rows quote the production search artifact by story id: title, episode
// fields, tags, artwork, and Apple links always resolve from the loaded
// artifact, so a future artifact rebuild flows through the rail without a
// separate edit. A story id that is no longer in the artifact drops its row
// and is reported; the rail never pads. The only copy authored here is the
// editorial framing the approved prototype (art_xhwN2LQ1) specifies, minus
// its New Year clause, which described a rail the ruling dropped.

import { classifyAppleUrl } from './links/apple-tv.mjs';

export const HOLIDAY_RAILS_PLACEHOLDER = '__HOLIDAY_RAILS__';

export const HOLIDAY_RAILS = [
  {
    id: 'rail-seasonal',
    title: 'This season',
    kind: 'featured',
    kindLabel: 'featured moment',
    sub: 'Christmas leads. Thanksgiving and winter hold secondary shelves.',
    rows: [
      {
        storyId: 'frog-and-toad-s1-e9',
        why: 'A friend is late on the night when being together matters most, and the story centers the worry, not the outcome.',
      },
      {
        storyId: 'sago-mini-friends-s2-e2-seg2',
        why: 'A saved snowball shrinks at every stop on the delivery route, and still lands big: Grandpa Jasper needed exactly that for lemonade.',
      },
      {
        storyId: 'interrupting-chicken-s1-e9-seg1',
        why: 'Ebenezer Wolf cancels the holidays, so Piper writes three ghosts of giving to remind him how good generosity felt.',
      },
      {
        storyId: 'get-rolling-with-otis-s1-e9',
        why: 'The only waiting-for-a-sibling row we have, and it happens at Christmas: a celebration interrupted by a due date.',
      },
    ],
  },
  {
    id: 'rail-thanksgiving',
    title: 'Thanksgiving',
    kind: 'secondary',
    kindLabel: 'seasonal · secondary',
    sub: 'Gratitude and togetherness, from saying it to making it to doing it.',
    rows: [
      {
        storyId: 'sago-mini-friends-s1-e11-seg1',
        why: 'A missed festival becomes Lumington\'s own Thankful Day, because Harvey thanks a bench out loud and the town starts to glow.',
      },
      {
        storyId: 'helpsters-help-you-s1-e6-seg1',
        why: 'Gratitude gets made into something: a thank-you song built by looping everyday sounds, for the workers who hold everything up.',
      },
      {
        storyId: 'pretzel-and-the-puppies-s1-e8-seg1',
        why: 'The pups act on an unthanked feeling: wash the fire truck so the crew can eat dinner and rescue more dogs. Gratitude turns out to be contagious.',
      },
      {
        storyId: 'shape-island-s2-e3-seg1',
        why: 'The mugnapping case uncovers the real thing: the toast of gratitude Square never got to give, and the postponed toast finally happens.',
      },
      {
        storyId: 'sago-mini-friends-s1-e2-seg2',
        why: 'A fort built for one is lonelier than it sounds. Harvey admits something does not feel right, and one friend becomes every friend.',
      },
      {
        storyId: 'eva-the-owlet-s1-e9',
        why: 'Missing distant family during a celebration: a town shows up for one lost bird, and the search becomes a lesson in community.',
      },
    ],
  },
  {
    id: 'rail-winter',
    title: 'Winter',
    kind: 'secondary',
    kindLabel: 'seasonal · secondary',
    sub: 'The solstice and the long gray stretch, including the letdown when the promised snow underdelivers.',
    rows: [
      {
        storyId: 'stillwater-s1-e13',
        why: 'A script-verified solstice story: a scary reputation can hide a friend, and the kids include their lonely neighbor by decorating his house.',
      },
      {
        storyId: 'shape-island-s1-e10',
        why: 'The most honest winter row we have: winter actually hurts, and a homemade holiday is what carries them through.',
      },
      {
        storyId: 'stillwater-s4-e5-seg2',
        why: 'The promised blizzard delivers a dusting. Everything\'s the best if it\'s what you need, and the day ends with sledding and a real storm.',
      },
      {
        storyId: 'pretzel-and-the-puppies-s1-e9',
        why: 'Plans ruined by weather, celebration anyway: the pups carry the festival to the snowed-in dogs, one doorstep at a time.',
      },
    ],
  },
];

/** The card title: the story segment when there is one, the episode title otherwise. */
export function railRowTitle(story) {
  return story.segmentTitle || story.episodeTitle || story.seriesTitle;
}

/** The episode line: series, season and episode, the story slot for multi-story episodes, then the age band. */
export function railRowEpisodeLine(story) {
  const parts = [story.seriesTitle, `S${story.seasonNumber} E${story.episodeNumber}`];
  if (story.segment) parts[1] += `, story ${story.segment}`;
  if (story.ageBand) parts.push(`ages ${story.ageBand.replace('-', ' to ')}`);
  return parts.join(' · ');
}

/**
 * Resolves rail definitions against the artifact's story rows. Every catalog
 * field on a resolved row quotes the artifact; a storyId the artifact does
 * not hold is dropped and reported in `unresolved`, never padded over.
 */
export function resolveHolidayRails(rails, storyById) {
  const unresolved = [];
  const resolvedRails = rails.map((rail) => {
    const rows = [];
    for (const def of rail.rows) {
      const story = storyById(def.storyId);
      if (!story) {
        unresolved.push(`${rail.id}: ${def.storyId}`);
        continue;
      }
      rows.push({
        storyId: story.id,
        title: railRowTitle(story),
        seriesTitle: story.seriesTitle,
        seasonNumber: story.seasonNumber,
        episodeNumber: story.episodeNumber,
        segment: story.segment,
        episodeLine: railRowEpisodeLine(story),
        ageBand: story.ageBand,
        vibe: story.vibe,
        emotions: story.emotions,
        displaySynopsis: story.displaySynopsis,
        stillUrl: story.stillUrl || null,
        posterUrl: story.posterUrl || null,
        appleUrl: story.appleUrl || null,
        linkKind: story.appleUrl ? classifyAppleUrl(story.appleUrl) : null,
        why: def.why,
      });
    }
    return { ...rail, rows };
  });
  return { rails: resolvedRails, unresolved };
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** One rail card. All text is escaped; catalog data can never inject markup. */
export function renderRailCard(row) {
  const art = row.stillUrl || row.posterUrl;
  const artKind = row.stillUrl ? 'Still from' : 'Series poster for';
  const tags = row.emotions
    .map((e) => `<span class="tag">${escapeHtml(e)}</span>`)
    .join('');
  const vibeTag = row.vibe ? `<span class="tag aged">${escapeHtml(row.vibe)}</span>` : '';
  const watch = row.appleUrl && row.linkKind
    ? `<a class="watch" href="${escapeHtml(row.appleUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Watch ${escapeHtml(row.seriesTitle)}, season ${row.seasonNumber} episode ${row.episodeNumber}, on Apple TV+">Watch on Apple TV+</a>`
    : '';
  return [
    '      <article class="rail-card">',
    '        <figure class="rail-still-wrap">',
    art
      ? `          <img class="rail-still" src="${escapeHtml(art)}" alt="${escapeHtml(`${artKind} ${row.seriesTitle}, ${row.title}`)}" loading="lazy">`
      : '',
    '        </figure>',
    `        <h3 class="rail-title">${escapeHtml(row.title)}</h3>`,
    `        <p class="rail-ep">${escapeHtml(row.episodeLine)}</p>`,
    `        <div class="tag-row">${tags}${vibeTag}</div>`,
    `        <p class="rail-why">${escapeHtml(row.why)}</p>`,
    ...(watch ? ['        <div class="rail-actions">', `          ${watch}`, '        </div>'] : []),
    '      </article>',
  ].filter((line) => line !== '').join('\n');
}

/** Server-side render of the holiday rails. Empty rails render as nothing: the shelf never pads. */
export function renderHolidayRails(resolvedRails) {
  const sections = [];
  for (const rail of resolvedRails) {
    if (!rail.rows.length) continue;
    sections.push([
      `  <section class="rail-section" id="${rail.id}" aria-label="${escapeHtml(rail.title)}">`,
      '    <div class="rail-head">',
      `      <h2>${escapeHtml(rail.title)}</h2>`,
      `      <span class="rail-kind">${escapeHtml(rail.kindLabel)}</span>`,
      '    </div>',
      `    <p class="rail-sub">${escapeHtml(rail.sub)}</p>`,
      '    <div class="rail">',
      rail.rows.map(renderRailCard).join('\n'),
      '    </div>',
      '  </section>',
    ].join('\n'));
  }
  return sections.join('\n');
}

/** Substitutes the rendered rails for the placeholder on the served page. */
export function applyHolidayRails(html, storyById, rails = HOLIDAY_RAILS) {
  const { rails: resolved } = resolveHolidayRails(rails, storyById);
  const rendered = renderHolidayRails(resolved);
  return html.split(HOLIDAY_RAILS_PLACEHOLDER).join(rendered);
}
