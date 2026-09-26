import {
  bodyField,
  eyebrowField,
  headingField,
  layout,
} from '../../model/fields';
import { compact, readItems, readText } from '../../model/read';
import type { BlockDefinition } from '../../model/types';
import { optionalCtaFields } from '../video/definition';

export interface FaqItem {
  question: string;
  answer: string;
}

export type FaqProps = {
  eyebrow?: string;
  heading?: string;
  body?: string;
  ctaLabel?: string;
  note?: string;
  items?: FaqItem[];
  contactLabel?: string;
  contactHref?: string;
};

/** The canvas prompt where the questions would be — shown only while editing. */
export const FAQ_EMPTY =
  'Add the questions people ask before they join, each with its answer.';

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
      'Questions that open to show their answers, with your heading beside them.'
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
      hint: 'Write each question the way a visitor would ask it.',
      control: 'items',
      maxItems: 12,
      itemFields: [
        { key: 'question', label: 'Question', control: 'text', maxLength: 160 },
        {
          key: 'answer',
          label: 'Answer',
          hint: 'Leave a blank line to start a new paragraph.',
          control: 'textarea',
          maxLength: 800,
        },
      ],
    },
    {
      key: 'contactLabel',
      label: 'Contact link text',
      hint: 'Optional, for example "Ask me anything". Shown with your questions.',
      control: 'text',
      inline: true,
      maxLength: 60,
    },
    {
      key: 'contactHref',
      label: 'Contact link',
      hint: 'An email address or a web page, for questions not answered here.',
      control: 'url',
      maxLength: 500,
    },
    ...optionalCtaFields,
  ],
  starter: ({ courseTitle }) => ({
    heading: 'Questions, answered',
    items: [
      {
        question: `Who is ${courseTitle} for?`,
        answer:
          'Anyone ready to begin. You do not need any experience, and each stage builds on the one before it.',
      },
      {
        question: 'How much time will it take?',
        answer:
          'Each practice is short, so the course fits around a busy week. Go at whatever pace suits you.',
      },
      {
        question: 'What do I need to start?',
        answer:
          'Somewhere quiet and a few minutes to yourself. Everything else is inside the course.',
      },
    ],
  }),
  sample: {
    heading: 'Questions, answered',
    items: [
      {
        question: 'Do I need any experience?',
        answer:
          'None at all. Week one starts from the very first breath, and every practice explains itself as you go.',
      },
      {
        question: 'How long is each practice?',
        answer: 'Twenty minutes, with a ten-minute version for the busy days.',
      },
      {
        question: 'What if I miss a day?',
        answer:
          'Pick up where you left off. Nothing expires, so a missed morning is just a morning.',
      },
      {
        question: 'Can I follow along on my phone?',
        answer:
          'Yes. Every practice plays on any device, and the audio downloads for walks and journeys.',
      },
      {
        question: 'Do I need any equipment?',
        answer: 'A mat or a folded blanket, and somewhere quiet. That is all.',
      },
      {
        question: 'Can I ask you questions along the way?',
        answer:
          'Yes. Each stage ends with a short check-in, and I read every note you send.',
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
      ctaLabel: readText(raw, 'ctaLabel', 40),
      note: readText(raw, 'note', 120),
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
