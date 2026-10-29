import { MediaTools } from 'librechat-data-provider';

const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];

const shared = `The result is saved to the user's files and charged to their HiveGPT credit. Call it when the user asks for this, also in the middle of a conversation; you do not need a special mode. Write prompts in English for best quality, but keep any text the user wants shown in the picture in their language.`;

export interface MediaToolDefinition {
  name: MediaTools;
  description: string;
  schema: Record<string, unknown>;
  responseFormat: 'content_and_artifact';
}

export const mediaToolDefinitions: Record<MediaTools, MediaToolDefinition> = {
  [MediaTools.image]: {
    name: MediaTools.image,
    description: `Generates one image from a description, or edits earlier images when you pass their ids. ${shared} The image is shown to the user automatically; do not repeat links or describe it at length afterwards.`,
    schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'A detailed description of the image: subject, style (photo, illustration, 3D render…), composition, lighting. For edits, a direct instruction such as "make the background blue".',
        },
        aspect_ratio: {
          type: 'string',
          enum: ASPECT_RATIOS,
          description:
            '16:9 or 3:2 for landscape, 9:16 or 2:3 for portrait, 1:1 for square (default).',
        },
        image_ids: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 4,
          description:
            'Ids of earlier images to edit or use as reference (each generated image reports its generated_image_id).',
        },
      },
      required: ['prompt'],
    },
    responseFormat: 'content_and_artifact',
  },
  [MediaTools.video]: {
    name: MediaTools.video,
    description: `Generates a short video clip from a description, optionally starting from an image. ${shared} It takes one to several minutes and costs much more than an image, so only call it when the user clearly asked for a video. Put the returned markdown link in your reply exactly as given; it plays inside the chat.`,
    schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'What happens in the clip: subject, motion, camera movement, lighting, mood, and sound if any.',
        },
        duration_seconds: { type: 'integer', minimum: 1, maximum: 60 },
        aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1'] },
        first_frame_image_id: {
          type: 'string',
          description: 'Id of an earlier image to animate as the first frame.',
        },
      },
      required: ['prompt'],
    },
    responseFormat: 'content_and_artifact',
  },
  [MediaTools.speech]: {
    name: MediaTools.speech,
    description: `Turns text into a spoken audio file (a voice-over, a reading, a message to send). ${shared} Pass the exact words to speak, in the user's language. Put the returned markdown link in your reply exactly as given; it plays inside the chat.`,
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The exact words to speak.' },
        voice: {
          type: 'string',
          description: 'A voice name from the list you were given, if any.',
        },
      },
      required: ['text'],
    },
    responseFormat: 'content_and_artifact',
  },
  [MediaTools.higgsfield]: {
    name: MediaTools.higgsfield,
    description: `Generates an image or a video with a Higgsfield model (SOUL, Kling, Seedance, Wan…), paid from HiveGPT credit. ${shared} Use it when the user asks for Higgsfield or one of its models; otherwise prefer ${MediaTools.image} and ${MediaTools.video}. Pick \`model\` from the Higgsfield list you were given and tell the user its price before a video. Put a returned video link in your reply exactly as given.`,
    schema: {
      type: 'object',
      properties: {
        model: { type: 'string', description: 'A model id from the Higgsfield list.' },
        prompt: { type: 'string', description: 'A detailed description of the image or clip.' },
        aspect_ratio: { type: 'string', enum: ASPECT_RATIOS },
        duration_seconds: { type: 'integer', minimum: 1, maximum: 60 },
        resolution: {
          type: 'string',
          description: 'For example 720p or 1080p, when the model takes one.',
        },
      },
      required: ['model', 'prompt'],
    },
    responseFormat: 'content_and_artifact',
  },
};
