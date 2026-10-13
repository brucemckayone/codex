/**
 * One practice as a picture-led card (03 X63, Codex-61zsk.52): what the card
 * shows, worked out once from the course's own view of the practice.
 *
 * SHARED. The "What's inside" carousel lays every practice out with its stage
 * named under it; a curriculum layout that groups practices by stage can lay
 * the same cards out with the stage line left off (`PracticeCard`'s `stage`
 * is optional). Both read the practice through `practiceCard`, so the kind,
 * the length and the picture are never worked out twice. The kind and length
 * are the curriculum's own words (03 X57), not a second copy of them.
 */
import type { Component } from 'svelte';
import { FileTextIcon, MusicIcon, VideoIcon } from '$lib/components/ui/Icon';
import type { IconProps } from '$lib/components/ui/Icon/types';
import type { JourneyPracticeView, JourneyStageView } from '$lib/page-builder';
import { getThumbnailSrcset } from '$lib/utils/image';
import { CURRICULUM_COPY } from '../curriculum/copy';
import { orderedStages } from '../curriculum/stages';
import { INSIDE_COPY } from './copy';

type PracticeType = JourneyPracticeView['contentType'];

export interface PracticeCardView {
  id: string;
  title: string;
  type: PracticeType;
  /** What it is: "Video", "Audio", "Reading". */
  kind: string;
  /** How long it takes: "12 min"; null when nobody measured it. */
  length: string | null;
  /** The picture's URL, or null: the card draws its kind's tile instead. */
  picture: string | null;
  /** The picture's stored sizes for `srcset`; '' when its URL has none. */
  srcset: string;
}

/** A card and the stage it sits in, for a run of cards across stages. */
export interface StagedPracticeCard {
  card: PracticeCardView;
  /** "Stage 2 · Breath". */
  stage: string;
}

const ICONS: Record<PracticeType, Component<IconProps>> = {
  video: VideoIcon,
  audio: MusicIcon,
  written: FileTextIcon,
};

/** The icon that says what a practice is, by its shape (as the curriculum's). */
export function practiceIcon(type: PracticeType): Component<IconProps> {
  return ICONS[type] ?? VideoIcon;
}

export function practiceCard(practice: JourneyPracticeView): PracticeCardView {
  const picture = practice.thumbnailUrl || null;
  return {
    id: practice.contentId,
    title: practice.title,
    type: practice.contentType,
    kind: CURRICULUM_COPY.kind(practice.contentType),
    length: CURRICULUM_COPY.length(practice.durationSeconds),
    picture,
    srcset: picture ? getThumbnailSrcset(picture) : '',
  };
}

/**
 * Every practice of the course, in the order a member meets them: the stages
 * in order, each stage's practices in order, each named with its stage.
 */
export function stagedPracticeCards(
  stages: readonly JourneyStageView[]
): StagedPracticeCard[] {
  return orderedStages(stages).flatMap((stage, index) =>
    stage.practices.map((practice) => ({
      card: practiceCard(practice),
      stage: INSIDE_COPY.stage(index + 1, stage.name),
    }))
  );
}
