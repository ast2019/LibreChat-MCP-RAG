import { z } from 'zod';

/** In-chat tools that turn the conversation into Office files the user downloads and edits. */
export enum OfficeTools {
  /** An article or report as a Word document */
  word = 'create_word_document',
  /** A slide deck as a PowerPoint file */
  slides = 'create_presentation',
}

export const OFFICE_TOOL_NAMES: readonly string[] = Object.values(OfficeTools);

/** Deployment skills that declare each tool; a tool follows its skill's scope on saved agents. */
export const OFFICE_TOOL_SKILLS: Readonly<Record<OfficeTools, readonly string[]>> = {
  [OfficeTools.word]: ['article-writer'],
  [OfficeTools.slides]: ['slide-builder'],
};

/**
 * Deployment skills behind a feature with its own row in the composer's «ساختن» menu. They are
 * left out of the skill lists, so each feature has one entry point, and that row stages them.
 */
export const FEATURE_SKILL_NAMES: readonly string[] = Object.values(OFFICE_TOOL_SKILLS).flat();

/** A deployment skill that belongs to a feature row rather than the skill lists. */
export function isFeatureSkill(skill: { name: string; source?: string }): boolean {
  return skill.source === 'deployment' && FEATURE_SKILL_NAMES.includes(skill.name);
}

/** The file context generated Office files are stored under. */
export const OFFICE_FILE_CONTEXT = 'document_generation';

/** Key of the files an Office tool saved, on its tool artifact. */
export const OFFICE_ARTIFACT_KEY = 'office_files';

export const officeToolsSchema = z.object({
  /** Word documents, the article wizard's output */
  word: z.boolean().default(true),
  /** PowerPoint decks */
  slides: z.boolean().default(true),
  /** Longest Markdown body one Word document takes, in characters */
  maxDocumentChars: z.number().int().min(1_000).max(500_000).default(150_000),
  /** Most slides in one deck */
  maxSlides: z.number().int().min(1).max(100).default(40),
  /** Most images one file embeds */
  maxImages: z.number().int().min(0).max(60).default(20),
  /** Embeds the Vazirmatn font in Word files, so Word shows it without installing it */
  embedFonts: z.boolean().default(true),
});

export type TOfficeToolsConfig = z.infer<typeof officeToolsSchema>;

/** Which Office tools ordinary chats offer, for the composer's «ساختن» rows. */
export type TOfficeToolsStartupConfig = {
  word: boolean;
  slides: boolean;
};
