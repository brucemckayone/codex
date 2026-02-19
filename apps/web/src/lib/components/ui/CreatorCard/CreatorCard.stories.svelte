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
        options: ['default', 'compact'],
        description: 'Display variant',
      },
    },
  });
</script>

<Story name="Default Creator Card">
  <CreatorCard
    username="johndoe"
    displayName="John Doe"
    avatar="https://picsum.photos/100/100"
    bio="Software developer and content creator. Love building things and sharing knowledge."
    contentCount={42}
    socialLinks={{
      website: "https://johndoe.com",
      twitter: "https://twitter.com/johndoe",
      youtube: "https://youtube.com/@johndoe"
    }}
  />
</Story>

<Story name="Compact Creator Card">
  <CreatorCard
    variant="compact"
    username="janedoe"
    displayName="Jane Doe"
    avatar="https://picsum.photos/100/100"
    contentCount={15}
  />
</Story>

<Story name="Without Avatar">
  <CreatorCard
    username="creator"
    displayName="AC"
    bio="Just getting started on my creator journey."
    contentCount={0}
  />
</Story>

<Story name="All Social Links">
  <CreatorCard
    username="supercreator"
    displayName="Super Creator"
    bio="I'm everywhere on the internet!"
    contentCount={100}
    socialLinks={{
      website: "https://example.com",
      twitter: "https://twitter.com/supercreator",
      youtube: "https://youtube.com/@supercreator",
      instagram: "https://instagram.com/supercreator"
    }}
  />
</Story>

<Story name="Compact Without Bio">
  <CreatorCard
    variant="compact"
    username="minimalist"
    displayName="Minimalist Creator"
    avatar="https://picsum.photos/100/100"
    contentCount={5}
  />
</Story>
