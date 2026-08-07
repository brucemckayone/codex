<!--
  CreatorCard stories.

  Documentation used to be inverted from reality: every story exercised `default`
  or `compact`, the two variants with no app consumer, while `showcase` — the one
  the org creators directory actually renders — had none. That is how a
  sample-derived count and a 4:5-vs-3:4 row misalignment survived unnoticed.
  `showcase` now leads, and its stories are the DATA STATES the directory has to
  hold rather than one happy path.

  Images point at the local dev-cdn (`:4100`), not an external placeholder
  service: local development is fully local here, so `picsum.photos` was both a
  rule violation and a story that broke offline. These keys resolve once the dev
  stack is running.
-->
<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { CreatorCard } from './';

  const { Story } = defineMeta({
    title: 'UI/CreatorCard',
    component: CreatorCard,
    tags: ['autodocs'],
    argTypes: {
      variant: {
        control: 'select',
        options: ['showcase', 'default', 'compact'],
        description:
          'Display variant. Only `showcase` has an app consumer today.',
      },
    },
  });

  const PHOTO = 'http://localhost:4100/avatars/a62da3ad5c94736a88f90ff5c666143c/md.webp';
</script>

<!-- ── showcase: the live variant ── -->

<Story name="Showcase">
  <div style="max-width: 13rem">
    <CreatorCard
      variant="showcase"
      username="mairead"
      displayName="Mairead Nic an Bhaird"
      avatar={PHOTO}
      bio="Somatic practitioner working with grief, lineage and the body that carries both."
      contentCount={4}
    />
  </div>
</Story>

<Story name="Showcase / no photo">
  <div style="max-width: 13rem">
    <CreatorCard
      variant="showcase"
      username="ffion"
      displayName="Ffion Llewellyn"
      bio="Trained first as a midwife, which is where I learned that a body under pressure tells the truth."
      contentCount={2}
    />
  </div>
</Story>

<Story name="Showcase / no bio, no content">
  <!-- Must occupy exactly the same height as the stories above: the directory's
       uniform rows depend on every text row being reserved. -->
  <div style="max-width: 13rem">
    <CreatorCard
      variant="showcase"
      username="noor"
      displayName="Noor Al-Rashid"
      avatar={PHOTO}
      contentCount={0}
    />
  </div>
</Story>

<Story name="Showcase / name that wraps">
  <!-- 38 characters, and the reason `.showcase__name` clamps to two lines and
       reserves both. -->
  <div style="max-width: 13rem">
    <CreatorCard
      variant="showcase"
      username="bartholomew-fitzwilliam"
      displayName="Bartholomew Fitzwilliam-Hargreaves III"
      avatar={PHOTO}
      bio="Ritual studies and ancestral cartography."
      contentCount={1}
    />
  </div>
</Story>

<Story name="Showcase / unbroken token">
  <!-- 19 characters with no break opportunity — the case `overflow-wrap:
       anywhere` exists for. -->
  <div style="max-width: 13rem">
    <CreatorCard
      variant="showcase"
      username=""
      displayName="Wachiwiwakaŋyeżawiŋ"
      avatar={PHOTO}
      bio="Ceremony, smoke, and the long walk back."
      contentCount={0}
    />
  </div>
</Story>

<Story name="Showcase / owner gets no special geometry">
  <!-- The owner used to switch the frame from 3:4 to 4:5, which pushed its
       neighbours' names 36px out of line. Role now lives in the drawer. -->
  <div style="display: grid; grid-template-columns: repeat(2, 13rem); gap: 1.25rem">
    <CreatorCard
      variant="showcase"
      username="luzura"
      displayName="Luzura Peralta"
      avatar={PHOTO}
      role="owner"
      bio="Multi-disciplinary artist of Celtic-Taíno descent."
      contentCount={15}
    />
    <CreatorCard
      variant="showcase"
      username="solveig"
      displayName="Solveig Bjørk"
      avatar={PHOTO}
      role="creator"
      bio="Movement practice for people told to sit still their whole lives."
      contentCount={1}
    />
  </div>
</Story>

<!-- ── default / compact: no app consumer; kept for the barrel's API ── -->

<Story name="Default (no app consumer)">
  <CreatorCard
    username="mairead"
    displayName="Mairead Nic an Bhaird"
    avatar={PHOTO}
    bio="Somatic practitioner working with grief, lineage and the body that carries both."
    contentCount={42}
    socialLinks={{
      website: 'https://example.test/mairead',
      twitter: 'https://example.test/twitter/mairead',
      youtube: 'https://example.test/youtube/mairead',
    }}
  />
</Story>

<Story name="Compact (no app consumer)">
  <CreatorCard
    variant="compact"
    username="solveig"
    displayName="Solveig Bjørk"
    avatar={PHOTO}
    contentCount={15}
  />
</Story>
