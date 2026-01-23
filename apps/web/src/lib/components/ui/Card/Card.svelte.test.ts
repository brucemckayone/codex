import { afterEach, describe, expect, test } from 'vitest';
import {
  createRawSnippet,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import Card from './Card.svelte';
import CardContent from './CardContent.svelte';
import CardDescription from './CardDescription.svelte';
import CardFooter from './CardFooter.svelte';
import CardHeader from './CardHeader.svelte';
import CardTitle from './CardTitle.svelte';

/**
 * Card component unit tests.
 *
 * Card is a simple compound component (no Melt-UI dependency).
 * All sub-components can be tested in isolation with standard mounting.
 */

describe('Card', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders children content', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span data-testid="card-child">Card content</span>',
    }));

    component = mount(Card, {
      target: document.body,
      props: { children },
    });

    expect(document.querySelector('[data-testid="card-child"]')).toBeTruthy();
    expect(document.querySelector('.card')).toBeTruthy();
  });

  test('applies custom className', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Card, {
      target: document.body,
      props: { children, class: 'custom-card' },
    });

    const card = document.querySelector('.card');
    expect(card?.classList.contains('custom-card')).toBe(true);
  });

  test('passes through HTML attributes', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Card, {
      target: document.body,
      props: {
        children,
        'data-testid': 'test-card',
        id: 'my-card',
      },
    });

    const card = document.querySelector('.card');
    expect(card?.getAttribute('data-testid')).toBe('test-card');
    expect(card?.getAttribute('id')).toBe('my-card');
  });

  test('renders as div element', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Card, {
      target: document.body,
      props: { children },
    });

    const card = document.querySelector('.card');
    expect(card?.tagName.toLowerCase()).toBe('div');
  });
});

describe('CardHeader', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders children content', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Header content</span>',
    }));

    component = mount(CardHeader, {
      target: document.body,
      props: { children },
    });

    expect(document.querySelector('.card-header')).toBeTruthy();
    expect(document.body.textContent).toContain('Header content');
  });

  test('applies custom className', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Header</span>',
    }));

    component = mount(CardHeader, {
      target: document.body,
      props: { children, class: 'custom-header' },
    });

    const header = document.querySelector('.card-header');
    expect(header?.classList.contains('custom-header')).toBe(true);
  });
});

describe('CardTitle', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders children content', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>My Title</span>',
    }));

    component = mount(CardTitle, {
      target: document.body,
      props: { children },
    });

    expect(document.querySelector('.card-title')).toBeTruthy();
    expect(document.body.textContent).toContain('My Title');
  });

  test('has heading role with default level 3', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Title</span>',
    }));

    component = mount(CardTitle, {
      target: document.body,
      props: { children },
    });

    const title = document.querySelector('.card-title');
    expect(title?.getAttribute('role')).toBe('heading');
    expect(title?.getAttribute('aria-level')).toBe('3');
  });

  test('accepts custom heading level', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Title</span>',
    }));

    component = mount(CardTitle, {
      target: document.body,
      props: { children, level: 2 },
    });

    const title = document.querySelector('.card-title');
    expect(title?.getAttribute('aria-level')).toBe('2');
  });

  test('applies custom className', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Title</span>',
    }));

    component = mount(CardTitle, {
      target: document.body,
      props: { children, class: 'custom-title' },
    });

    const title = document.querySelector('.card-title');
    expect(title?.classList.contains('custom-title')).toBe(true);
  });
});

describe('CardDescription', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders children content', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Description text</span>',
    }));

    component = mount(CardDescription, {
      target: document.body,
      props: { children },
    });

    expect(document.querySelector('.card-description')).toBeTruthy();
    expect(document.body.textContent).toContain('Description text');
  });

  test('renders as paragraph element', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Description</span>',
    }));

    component = mount(CardDescription, {
      target: document.body,
      props: { children },
    });

    const desc = document.querySelector('.card-description');
    expect(desc?.tagName.toLowerCase()).toBe('p');
  });

  test('applies custom className', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Description</span>',
    }));

    component = mount(CardDescription, {
      target: document.body,
      props: { children, class: 'custom-desc' },
    });

    const desc = document.querySelector('.card-description');
    expect(desc?.classList.contains('custom-desc')).toBe(true);
  });
});

describe('CardContent', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders children content', () => {
    const children = createRawSnippet(() => ({
      render: () => '<p>Main content</p>',
    }));

    component = mount(CardContent, {
      target: document.body,
      props: { children },
    });

    expect(document.querySelector('.card-content')).toBeTruthy();
    expect(document.body.textContent).toContain('Main content');
  });

  test('applies custom className', () => {
    const children = createRawSnippet(() => ({
      render: () => '<p>Content</p>',
    }));

    component = mount(CardContent, {
      target: document.body,
      props: { children, class: 'custom-content' },
    });

    const content = document.querySelector('.card-content');
    expect(content?.classList.contains('custom-content')).toBe(true);
  });
});

describe('CardFooter', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders children content', () => {
    const children = createRawSnippet(() => ({
      render: () => '<button>Submit</button>',
    }));

    component = mount(CardFooter, {
      target: document.body,
      props: { children },
    });

    expect(document.querySelector('.card-footer')).toBeTruthy();
    expect(document.querySelector('button')).toBeTruthy();
  });

  test('applies custom className', () => {
    const children = createRawSnippet(() => ({
      render: () => '<button>Action</button>',
    }));

    component = mount(CardFooter, {
      target: document.body,
      props: { children, class: 'custom-footer' },
    });

    const footer = document.querySelector('.card-footer');
    expect(footer?.classList.contains('custom-footer')).toBe(true);
  });
});

describe('Card compound component integration', () => {
  test('all components can be imported together', () => {
    expect(Card).toBeDefined();
    expect(CardHeader).toBeDefined();
    expect(CardTitle).toBeDefined();
    expect(CardDescription).toBeDefined();
    expect(CardContent).toBeDefined();
    expect(CardFooter).toBeDefined();
  });

  test('index exports named components and aliases', async () => {
    const exports = await import('./index.js');
    // Direct exports
    expect(exports.Card).toBeDefined();
    expect(exports.CardHeader).toBeDefined();
    expect(exports.CardTitle).toBeDefined();
    expect(exports.CardDescription).toBeDefined();
    expect(exports.CardContent).toBeDefined();
    expect(exports.CardFooter).toBeDefined();
    // Aliases
    expect(exports.Root).toBeDefined();
    expect(exports.Header).toBeDefined();
    expect(exports.Title).toBeDefined();
    expect(exports.Description).toBeDefined();
    expect(exports.Content).toBeDefined();
    expect(exports.Footer).toBeDefined();
  });
});
