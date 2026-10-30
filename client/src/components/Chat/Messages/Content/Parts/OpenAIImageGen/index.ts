export { default as ImageGen } from './OpenAIImageGen';
export { default as OpenAIImageGen } from './OpenAIImageGen';

/** Tools whose card draws the generated image from the call's attachment. `generate_image` is
 *  HiveGPT's in-chat image generator. */
export const AGENT_STYLE_TOOLS = new Set([
  'image_gen_oai',
  'image_edit_oai',
  'gemini_image_gen',
  'generate_image',
]);
