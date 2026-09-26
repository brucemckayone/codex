import {
  bodyField,
  eyebrowField,
  headingField,
  layout,
} from '../../model/fields';
import { compact, readItems, readText } from '../../model/read';
import type { BlockDefinition } from '../../model/types';

export interface FaqItem {
  question: string;
  answer: string;
}

export type FaqProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  items?: FaqItem[];
  contactLabel?: string;
  contactHref?: string;
};

export const faqDefinition: BlockDefinition<FaqProps> = {
  type: 'faq',
  label: 'Questions',
  description: 'Answer the questions people ask before they join.',
  group: 'details',
  icon: 'FileTextIcon',
  layouts: [
    layout(
      'accordion',
      'Expandable list',
      'Questions that open to show the answer.'
    ),
    layout(
      'columns',
      'Two columns',
      'Every question and answer on show, in two columns.'
    ),
  ],
  fields: [
    eyebrowField,
    headingField(100),
    { ...bodyField, maxLength: 400 },
    {
      key: 'items',
      label: 'Questions and answers',
      control: 'items',
      maxItems: 12,
      itemFields: [
        { key: 'question', label: 'Question', control: 'text', maxLength: 160 },
        { key: 'answer', label: 'Answer', control: 'textarea', maxLength: 800 },
      ],
    },
    {
      key: 'contactLabel',
      label: 'Contact link text',
      hint: 'Optional, for example "Ask me anything".',
      control: 'text',
      maxLength: 60,
    },
    {
      key: 'contactHref',
      label: 'Contact link',
      control: 'url',
      maxLength: 500,
    },
  ],
  starter: ({ courseTitle }) => ({
    heading: 'Questions',
    items: [
      {
        question: `Who is ${courseTitle} for?`,
        answer:
          'Anyone ready to take the first step. You do not need any experience to begin.',
      },
      {
        question: 'How much time will it take?',
        answer: 'Each lesson is short, so it fits around a busy week.',
      },
    ],
  }),
  sample: {
    heading: 'Questions',
    items: [
      {
        question: 'Do I need any experience?',
        answer: 'None at all. Week one starts from the very first breath.',
      },
      {
        question: 'How long is each practice?',
        answer: 'Twenty minutes, with shorter versions for busy days.',
      },
      {
        question: 'What if I miss a day?',
        answer:
          'Pick up where you left off. Nothing expires and nothing is lost.',
      },
    ],
    contactLabel: 'Ask me anything',
    contactHref: 'mailto:hello@example.com',
  },
  coerce: (raw) =>
    compact({
      eyebrow: readText(raw, 'eyebrow', 60),
      heading: readText(raw, 'heading', 100),
      body: readText(raw, 'body', 400),
      items: readItems(
        raw,
        'items',
        (entry) => {
          const question = readText(entry, 'question', 160);
          const answer = readText(entry, 'answer', 800);
          return question && answer ? { question, answer } : null;
        },
        12
      ),
      contactLabel: readText(raw, 'contactLabel', 60),
      contactHref: readText(raw, 'contactHref', 500),
    }),
};
