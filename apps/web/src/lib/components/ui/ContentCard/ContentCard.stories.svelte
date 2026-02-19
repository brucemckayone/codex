<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { ContentCard } from './';

  const { Story } = defineMeta({
    title: 'UI/ContentCard',
    component: ContentCard,
    tags: ['autodocs'],
    argTypes: {
      contentType: {
        control: 'select',
        options: ['video', 'audio', 'article'],
        description: 'Type of content',
      },
      loading: {
        control: 'boolean',
        description: 'Show loading skeleton state',
      },
    },
  });
</script>

<Story name="Video Content">
  <ContentCard
    id="1"
    title="Building a SaaS from Scratch"
    description="Learn how to build a complete SaaS application from idea to launch."
    contentType="video"
    duration={3600}
    thumbnail="https://picsum.photos/400/225"
    creator={{
      username: "johndoe",
      displayName: "John Doe",
      avatar: null
    }}
    href="/content/1"
  />
</Story>

<Story name="Audio Content">
  <ContentCard
    id="2"
    title="The Future of AI in Software Development"
    description="A deep dive into how AI is changing the way we write code."
    contentType="audio"
    duration={2700}
    creator={{
      username: "janedoe",
      displayName: "Jane Doe"
    }}
    href="/content/2"
  />
</Story>

<Story name="Article Content">
  <ContentCard
    id="3"
    title="10 Tips for Better TypeScript"
    description="Improve your TypeScript skills with these practical tips."
    contentType="article"
    creator={{
      username: "typescriptfan",
      displayName: "TypeScript Fan"
    }}
    href="/content/3"
  />
</Story>

<Story name="Loading State" args={{ loading: true }}>
  <ContentCard
    id="4"
    title="Loading Content"
    loading={true}
  />
</Story>

<Story name="Without Thumbnail">
  <ContentCard
    id="5"
    title="Content Without Thumbnail"
    description="This content has no thumbnail image."
    contentType="article"
    creator={{
      username: "creator",
      displayName: "Content Creator"
    }}
    href="/content/5"
  />
</Story>

<Story name="All Types Grid">
  <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem;">
    <ContentCard
      id="video-1"
      title="Video Tutorial"
      description="Learn about video production."
      contentType="video"
      duration={1800}
      creator={{ username: "videocreator", displayName: "Video Creator" }}
      href="/content/video-1"
    />
    <ContentCard
      id="audio-1"
      title="Audio Podcast"
      description="Listen to our latest episode."
      contentType="audio"
      duration={3600}
      creator={{ username: "podcaster", displayName: "Podcast Host" }}
      href="/content/audio-1"
    />
    <ContentCard
      id="article-1"
      title="Written Article"
      description="Read this in-depth analysis."
      contentType="article"
      creator={{ username: "writer", displayName: "Writer" }}
      href="/content/article-1"
    />
  </div>
</Story>
