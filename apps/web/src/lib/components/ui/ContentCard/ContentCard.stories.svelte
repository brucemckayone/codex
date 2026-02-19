<script module>
  import { ContentCard } from './';
</script>

<Story name="Video Content">
  <Template>
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
  </Template>
</Story>

<Story name="Audio Content">
  <Template>
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
  </Template>
</Story>

<Story name="Article Content">
  <Template>
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
  </Template>
</Story>

<Story name="Loading State">
  <Template>
    <ContentCard
      id="4"
      title="Loading Content"
      loading={true}
    />
  </Template>
</Story>
