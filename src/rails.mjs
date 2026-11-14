// The rails: the seasonal shelf plus the four situation rails from the
// approved corpus-grounded recommendations (art_tRsPwTVl, 2026-11-14), in the
// approved order: Something New, Big Feelings, Friendship Trouble, Wind-Down.
// Each shipped rail clears an eight-row depth floor measured on the artifact
// at authoring time, and test/rails.test.mjs holds that floor: a rail whose
// resolved pool drops below eight rows fails the suite rather than shipping
// as a thin shelf.
//
// Rows quote the production search artifact by story id: title, episode
// fields, tags, artwork, and Apple links always resolve from the loaded
// artifact, so a future artifact rebuild flows through the rail without a
// separate edit. A story id that is no longer in the artifact drops its row
// and is reported; the rail never pads. The only copy authored here is the
// editorial framing: the approved description and the per-row why lines.

import { classifyAppleUrl } from './links/apple-tv.mjs';

export const HOLIDAY_RAILS_PLACEHOLDER = '__HOLIDAY_RAILS__';

export const HOLIDAY_RAILS = [
  {
    id: 'rail-this-season',
    title: 'This Season',
    sub: 'Cozy seasonal stories for the weeks ahead, all about gratitude, giving, and being together, from Thanksgiving tables to quiet winter nights.',
    rows: [
      {
        // Thanksgiving first: six rows.
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
      {
        // Christmas: four rows.
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
      {
        // Winter: four rows.
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
  {
    id: 'rail-something-new',
    title: 'Something New',
    sub: 'First days, new places, wobbly tries. Each story starts with the nervous feeling before something new and ends with the brave after it.',
    rows: [
      {
        storyId: 'camp-snoopy-s1-e1-seg1',
        why: 'A troop with zero badges gets a deadline, and Snoopy turns panic into a plan: one small badge at a time.',
      },
      {
        storyId: 'camp-snoopy-s1-e1-seg2',
        why: 'Marcie would rather stay on solid ground, and a glassy lake with patient coaching turns the wobbly canoe into a day she is proud of.',
      },
      {
        storyId: 'duck-and-goose-s1-e2-seg1',
        why: 'Goose is sure everything new is too slimy, too pointy, or too sandy, until each friend tries the other\'s way and new turns gorgeous up close.',
      },
      {
        storyId: 'frog-and-toad-s1-e2-seg1',
        why: 'Toad\'s kind gesture melts all over him in the sun, and the confession is met with the kindness behind the accident, not the mess.',
      },
      {
        storyId: 'frog-and-toad-s1-e4-seg2',
        why: 'Frog does not know how to bake a cake, and saying so out loud turns the takeover into doing it together.',
      },
      {
        storyId: 'interrupting-chicken-s1-e2-seg1',
        why: 'Piper jumps in and ends the story on the spot, then writes a second draft where the surprise works for her.',
      },
      {
        storyId: 'pretzel-and-the-puppies-s1-e2-seg1',
        why: 'Puck plans to go home hungry rather than try anything new, and ends up mixing the kibble he wants to taste.',
      },
      {
        storyId: 'eva-the-owlet-s1-e3-seg1',
        why: 'Eva tries to do a big secret thing all alone, and finds out the whole class wanted in on the surprise.',
      },
      {
        storyId: 'harriet-the-spy-s1-e10-seg1',
        why: 'Even grown ups chicken out of big and scary firsts: learning to ride a bike means eyes up, looking where you want to go.',
      },
      {
        storyId: 'sago-mini-friends-s1-e10-seg2',
        why: 'Harvey catches the ice cream and loses the game in the same jump, and it turns out trying it counts for more than winning.',
      },
    ],
  },
  {
    id: 'rail-big-feelings',
    title: 'Big Feelings',
    sub: 'For the nights when it all boils over: kids get angry, frustrated, and impatient, then find their way back.',
    rows: [
      {
        storyId: 'camp-snoopy-s1-e3-seg2',
        why: 'A craft session turns into a bracelet standoff, and the way back is honest compliments plus the reminder that there is no right way to make something for a friend.',
      },
      {
        storyId: 'duck-and-goose-s1-e2-seg2',
        why: 'Duck\'s perfectly good height suddenly feels wrong on measuring day, and every growth scheme flops into laughter instead of nursing the feeling.',
      },
      {
        storyId: 'duck-and-goose-s1-e3-seg1',
        why: 'The kite will not fly, and each flop is treated as information: retie the knot, free the friend, run against the breeze.',
      },
      {
        storyId: 'sago-mini-friends-s1-e1-seg1',
        why: 'Robin wants pizza now, pizza pizza pizza, and the waiting turns into a song instead of a battle.',
      },
      {
        storyId: 'shape-island-s1-e1-seg1',
        why: 'Square names the whole stack out loud, mad about the plan, then bad about the mad, then sad about that, and keeps the friendship anyway.',
      },
      {
        storyId: 'harriet-the-spy-s1-e2-seg1',
        why: 'Harriet is angry enough to dig for proof, and the angry finds its way into a stand the scared kids can join out loud.',
      },
      {
        storyId: 'stillwater-s1-e11-seg1',
        why: 'Michael regrets a gift given, and the way back is naming the frustration, taking a breath, and apologizing for the anger.',
      },
      {
        storyId: 'eva-the-owlet-s1-e2-seg1',
        why: 'Eva\'s super helpful list runs out, and the sunrise answer is giving the credit away honestly.',
      },
      {
        storyId: 'frog-and-toad-s1-e1-seg1',
        why: 'The last very last cookie keeps coming back, and willpower finally looks like giving the whole batch to the robins.',
      },
      {
        storyId: 'wolfboy-and-the-everything-factory-s1-e8-seg1',
        why: 'A prank war escalates past anyone\'s intent, and it ends the way fights do here, with the real investigation and mutual apologies.',
      },
    ],
  },
  {
    id: 'rail-friendship-trouble',
    title: 'Friendship Trouble',
    sub: 'Left out, left behind, or sorry after a fight? The rough parts of friendship, and how kids find each other again.',
    rows: [
      {
        storyId: 'camp-snoopy-s1-e10-seg1',
        why: 'Sally quietly panics that being bad at things could cost her a best friend, and secret practice plus a game they can win together bring her back.',
      },
      {
        storyId: 'camp-snoopy-s1-e2-seg1',
        why: 'Sally insists she is absolutely not homesick, until caring for a lost baby bird helps her say it out loud and a new friend makes camp better.',
      },
      {
        storyId: 'frog-and-toad-s1-e1-seg2',
        why: 'No one has ever sent Toad a letter, so Frog writes the first one and mails it by the slowest courier available.',
      },
      {
        storyId: 'surfside-girls-s1-e1-seg1',
        why: 'Sam wants the mystery to be hers and Jade\'s alone, and when sci camp pulls Jade away, a doubloon trail speaks instead of a sulk.',
      },
      {
        storyId: 'duck-and-goose-s2-e2-seg2',
        why: 'The new kid has been playing Duck, Duck, Goose alone with pinecones, and a warning system means nobody leaves when she sprays.',
      },
      {
        storyId: 'shape-island-s1-e1-seg2',
        why: 'Circle admits she was jealous of the one thing her friends knew first, and a lantern red moon turns the secret into a club with her in it.',
      },
      {
        storyId: 'ghostwriter-s1-e1-seg1',
        why: 'Ruben is the new kid again, and an ice pack plus one shared conversation become the first friendship.',
      },
      {
        storyId: 'harriet-the-spy-s1-e4-seg1',
        why: 'Harriet learns peace turns to loneliness fast, and the trick is letting the world in, 26 cats included.',
      },
      {
        storyId: 'get-rolling-with-otis-s2-e7-seg1',
        why: 'The holes keep coming back because a lonely voice in one is looking for friends, and the farm gains three burrowers.',
      },
      {
        storyId: 'wolfboy-and-the-everything-factory-s1-e9-seg1',
        why: 'Wolfboy skips the play for secret world saving, and the apology that works is the honest one, prophecy and all.',
      },
    ],
  },
  {
    id: 'rail-wind-down',
    title: 'Wind-Down',
    sub: 'Slow, gentle stories for the end of the day. Calm ones that meet a tired kid where they are and don\'t wind anybody up.',
    rows: [
      {
        storyId: 'pretzel-and-the-puppies-s2-e2-seg2',
        why: 'Puck cannot sleep with the big bone hide tomorrow, and the tool that works is quiet, snuggle, breathe.',
      },
      {
        storyId: 'get-rolling-with-otis-s1-e4-seg2',
        why: 'Louie cannot fall asleep no matter what, and the fix is a tractor trick that shades a too bright moon.',
      },
      {
        storyId: 'frog-and-toad-s1-e2-seg2',
        why: 'A whole day of button hunting ends on Toad\'s own floor, and the jacket comes back sewn and handed over.',
      },
      {
        storyId: 'get-rolling-with-otis-s1-e5-seg2',
        why: 'Celeste needs quiet for a new song, and the farm builds it with her, one quiet spot at a time.',
      },
      {
        storyId: 'duck-and-goose-s1-e1-seg1',
        why: 'A patient watch over a round thing that might be an egg, practiced with a bird doll and kept through the rain.',
      },
      {
        storyId: 'sago-mini-friends-s1-e10-seg1',
        why: 'A small Wednesday ritual meets a rainstorm and bends without breaking: still Wedding Wednesday, just drier.',
      },
      {
        storyId: 'stillwater-s1-e6-seg2',
        why: 'The perfect paper airplane keeps missing, and letting the day be about joy instead of the outcome is where the fun comes back.',
      },
      {
        storyId: 'stillwater-s1-e9-seg2',
        why: 'A beach day teaches that pride is a feeling, not something the sandcastle has to keep.',
      },
      {
        storyId: 'helpsters-help-you-s1-e1-seg1',
        why: 'The park is closed, and the tree gets made instead: one big disappointment broken into three small jobs.',
      },
      {
        storyId: 'stillwater-s1-e10-seg2',
        why: 'Addy\'s disappointment passes, and being happy for her friend gets easy, which lets the friend be happy too.',
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
        situation: story.situation,
        coping: story.coping,
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

/** Age bands read like the filter labels: '2-4' becomes 'ages 2 to 4'. */
function formatAgeBand(band) {
  const m = /^([\d]+)-([\d]+)$/.exec(band || '');
  return m ? `ages ${m[1]} to ${m[2]}` : band || 'all ages';
}

/** One rail card. All text is escaped; catalog data can never inject markup. */
export function renderRailCard(row) {
  const art = row.stillUrl || row.posterUrl;
  const artKind = row.stillUrl ? 'Still from' : 'Series poster for';
  const tags = row.emotions
    .map((e) => `<span class="tag">${escapeHtml(e)}</span>`)
    .join('');
  const vibeTag = row.vibe ? `<span class="tag aged">${escapeHtml(row.vibe)}</span>` : '';
  // Honest-link rule: the play button renders only on rows with a verified
  // link. The visible UI never names Apple TV; the accessible name does.
  // The name carries the segment title too: two stories from one episode can
  // share a rail, and identical accessible names would not distinguish them.
  const watch = row.appleUrl && row.linkKind
    ? `<a class="watch-play" href="${escapeHtml(row.appleUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Watch on Apple TV: ${escapeHtml(row.seriesTitle)}, ${escapeHtml(row.title)}, season ${row.seasonNumber} episode ${row.episodeNumber}"><img class="watch-play-icon" src="/play-button.png" alt="" width="44" height="40"></a>`
    : '';
  // The expanded card view rides inside the card as inert template content:
  // the tapped card carries its own parent-facing fields (situation,
  // resolution, synopsis), so nothing is stored and nothing is fetched.
  // 'coping' is the field key; 'Resolution' is its display label.
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
    '        <template class="rail-detail">',
    '          <dl class="rail-detail-list">',
    `            <div class="rail-detail-field"><dt>Situation</dt><dd>${escapeHtml(row.situation)}</dd></div>`,
    `            <div class="rail-detail-field"><dt>Ages</dt><dd>${escapeHtml(formatAgeBand(row.ageBand))}</dd></div>`,
    `            <div class="rail-detail-field"><dt>Feelings</dt><dd>${tags || 'not tagged'}</dd></div>`,
    `            <div class="rail-detail-field"><dt>Resolution</dt><dd>${escapeHtml(row.coping)}</dd></div>`,
    `            <div class="rail-detail-field"><dt>What happens</dt><dd>${escapeHtml(row.displaySynopsis)}</dd></div>`,
    '          </dl>',
    '        </template>',
    '        <button class="rail-card-more" type="button" aria-haspopup="dialog">Story details</button>',
    ...(watch ? ['        <div class="rail-actions">', `          ${watch}`, '        </div>'] : []),
    '      </article>',
  ].filter((line) => line !== '').join('\n');
}

/**
 * Server-side render of the seasonal rail. The count chip is computed from
 * the resolved rows so the honest-count rule holds even if a row drops.
 * Empty rail renders as nothing: the shelf never pads.
 */
export function renderHolidayRails(resolvedRails) {
  const sections = [];
  for (const rail of resolvedRails) {
    if (!rail.rows.length) continue;
    sections.push([
      `  <section class="rail-section" id="${rail.id}" aria-label="${escapeHtml(rail.title)}">`,
      '    <div class="rail-head">',
      `      <h2>${escapeHtml(rail.title)}</h2>`,
      `      <span class="rail-count">${rail.rows.length} stories</span>`,
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
