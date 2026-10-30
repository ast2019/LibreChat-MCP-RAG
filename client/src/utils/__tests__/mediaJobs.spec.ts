import { ContentTypes } from 'librechat-data-provider';
import type { TMessageContentParts } from 'librechat-data-provider';
import { collectToolMediaJobIds, findMediaJobId } from '../mediaJobs';

const JOB = '6720f1c2a9b3c4d5e6f70812';

const call = (name: string, output: string) =>
  ({
    type: ContentTypes.TOOL_CALL,
    [ContentTypes.TOOL_CALL]: { id: `call-${name}`, name, args: '{}', output },
  }) as unknown as TMessageContentParts;

describe('findMediaJobId', () => {
  it('reads the job from the tool text, in the new and the old wording', () => {
    expect(findMediaJobId(`… do not write any link to it. Job: /api/media/jobs/${JOB}`)).toBe(JOB);
    expect(findMediaJobId(`Put this markdown: [🎬 video](/api/media/jobs/${JOB})`)).toBe(JOB);
  });

  it('finds nothing in a refusal or a malformed id', () => {
    expect(findMediaJobId('Image, video and audio generation are part of paid packs.')).toBeNull();
    expect(findMediaJobId('/api/media/jobs/job7')).toBeNull();
    expect(findMediaJobId(`/api/media/jobs/${JOB}ff`)).toBeNull();
    expect(findMediaJobId(undefined)).toBeNull();
  });
});

describe('collectToolMediaJobIds', () => {
  it('collects only the jobs generate_video started in this message', () => {
    const content = [
      call('generate_video', `Job: /api/media/jobs/${JOB.toUpperCase()}`),
      call('higgsfield_generate', '[🎬 video](/api/media/jobs/6720f1c2a9b3c4d5e6f70999)'),
      { type: ContentTypes.TEXT, text: `[🎬 video](/api/media/jobs/${JOB})` },
      undefined,
    ] as Array<TMessageContentParts | undefined>;
    expect([...collectToolMediaJobIds(content)]).toEqual([JOB]);
  });
});
