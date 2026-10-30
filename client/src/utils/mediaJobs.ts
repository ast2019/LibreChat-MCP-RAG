import { ContentTypes, MediaTools } from 'librechat-data-provider';
import type { Agents, TMessageContentParts } from 'librechat-data-provider';

/** A job link anywhere in a tool's text result, e.g. `[🎬 video](/api/media/jobs/<id>)`. */
const JOB_IN_TEXT = /\/api\/media\/jobs\/([a-f0-9]{24})(?![a-f0-9])/i;

/** The background job a `generate_video` result started, or null when it started none. */
export function findMediaJobId(output: string | null | undefined): string | null {
  if (typeof output !== 'string' || output === '') {
    return null;
  }
  return JOB_IN_TEXT.exec(output)?.[1] ?? null;
}

/**
 * Jobs whose card the message already draws from the `generate_video` call itself, so a link
 * the model also wrote in its reply does not draw the same video twice.
 */
export function collectToolMediaJobIds(
  content: ReadonlyArray<TMessageContentParts | undefined> | undefined,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const part of content ?? []) {
    if (part?.type !== ContentTypes.TOOL_CALL) {
      continue;
    }
    const call = part[ContentTypes.TOOL_CALL] as Agents.ToolCall | undefined;
    if (call?.name !== MediaTools.video) {
      continue;
    }
    const id = findMediaJobId(typeof call.output === 'string' ? call.output : null);
    if (id != null) {
      ids.add(id.toLowerCase());
    }
  }
  return ids;
}
