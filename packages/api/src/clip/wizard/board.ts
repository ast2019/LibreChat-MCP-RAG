import type { TClipToolsConfig, TClipWizardStoryboard } from 'librechat-data-provider';
import type { LlmParsed } from './llm';
import { repairFeedback } from './prompt';
import { parseClipInput } from '../scene';
import { extractJson } from './llm';

export const isObj = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Fields the wizard sets itself (voice, preview, logo) are never taken from the model. */
const OWN_FIELDS = ['audio', 'preview', 'logo_file_id', 'version'];

/** The model's storyboard as the wizard keeps it, or null when it is not an object with scenes. */
export function cleanBoard(raw: unknown, aspectRatio?: string): TClipWizardStoryboard | null {
  if (!isObj(raw) || !Array.isArray(raw.scenes)) {
    return null;
  }
  const board: TClipWizardStoryboard = { ...raw };
  for (const key of OWN_FIELDS) {
    delete board[key];
  }
  if (aspectRatio) {
    board.aspect_ratio = aspectRatio;
  }
  return board;
}

/** The validator's problems with a storyboard (the same one validate and render use). */
export function boardIssues(board: TClipWizardStoryboard, config: TClipToolsConfig): string[] {
  const parsed = parseClipInput({ ...board, audio: { mode: 'none' }, preview: false }, config);
  return 'errors' in parsed ? parsed.errors : [];
}

const NOT_JSON = 'Answer with one JSON object only, in the format from the instructions.';

/** Parser for a draft answer: `{ "storyboard": {...} }`, or the storyboard itself. */
export const draftParser =
  (config: TClipToolsConfig, aspectRatio?: string) =>
  (text: string): LlmParsed<TClipWizardStoryboard> => {
    const json = extractJson(text);
    const board = cleanBoard(isObj(json) && isObj(json.storyboard) ? json.storyboard : json, aspectRatio);
    if (!board) {
      return { ok: false, feedback: NOT_JSON };
    }
    const issues = boardIssues(board, config);
    return issues.length ? { ok: false, feedback: repairFeedback(issues) } : { ok: true, value: board };
  };

/** Parser for a chat answer: `{ "reply": string, "storyboard"?: {...} }`. */
export const chatParser =
  (config: TClipToolsConfig, aspectRatio?: string) =>
  (text: string): LlmParsed<{ reply: string; storyboard: TClipWizardStoryboard | null }> => {
    const json = extractJson(text);
    if (!isObj(json)) {
      return { ok: false, feedback: NOT_JSON };
    }
    const reply = typeof json.reply === 'string' ? json.reply.trim().slice(0, 2_000) : '';
    if (json.storyboard == null) {
      return reply ? { ok: true, value: { reply, storyboard: null } } : { ok: false, feedback: NOT_JSON };
    }
    const board = cleanBoard(json.storyboard, aspectRatio);
    if (!board) {
      return { ok: false, feedback: NOT_JSON };
    }
    const issues = boardIssues(board, config);
    return issues.length
      ? { ok: false, feedback: repairFeedback(issues) }
      : { ok: true, value: { reply, storyboard: board } };
  };
