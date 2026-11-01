import { OfficeTools } from 'librechat-data-provider';
import { SLIDE_LAYOUTS } from './layouts';
import { CHART_KINDS } from './charts';
import { DECK_STYLES } from './theme';

export interface OfficeToolDefinition {
  name: OfficeTools;
  description: string;
  schema: Record<string, unknown>;
  responseFormat: 'content_and_artifact';
}

const shared = `The chat shows the file to the user as a card they download; do not write a link to it. Building the file costs the user nothing beyond this conversation. To change a file later, call the tool again with the whole updated content and the next \`version\`; earlier versions stay in the chat. Write the user's text in their language and keep Persian text in Persian digits.`;

const imageIdHint =
  'An image id: a generated_image_id returned by generate_image, or an image the user attached to this request.';

const chartSchema = {
  type: 'object',
  description: 'A native chart the user can edit in the app, made from these numbers.',
  properties: {
    type: { type: 'string', enum: CHART_KINDS },
    title: { type: 'string' },
    categories: {
      type: 'array',
      items: { type: 'string' },
      description: 'Labels along the axis, or the slices of a pie.',
    },
    series: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          values: {
            type: 'array',
            items: { type: 'number' },
            description: 'One number for each category, in order.',
          },
        },
        required: ['name', 'values'],
      },
    },
    unit: { type: 'string', description: 'For example ٪ or میلیون تومان.' },
    stacked: { type: 'boolean' },
  },
  required: ['type', 'categories', 'series'],
};

export const officeToolDefinitions: Record<OfficeTools, OfficeToolDefinition> = {
  [OfficeTools.word]: {
    name: OfficeTools.word,
    description: `Builds a professional Word (.docx) file from a finished article, report or other long document. A Persian document is right to left throughout, embeds the Vazirmatn font so Word shows it without installing anything, and gets a cover page, a linked table of contents, Word's own heading styles, page numbers, tables, quotes, images with captions and native editable charts. Spelling is tidied with the same rules as persian_normalize. Call it with the final text when the user wants a Word file, or at the end of the article wizard. ${shared}`,
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The document title, shown on the cover.' },
        subtitle: { type: 'string' },
        author: { type: 'string' },
        summary: {
          type: 'string',
          description: 'An abstract or lead, shown in a box before the body.',
        },
        keywords: { type: 'array', items: { type: 'string' } },
        markdown: {
          type: 'string',
          description:
            'The body in Markdown: ## and ### headings, paragraphs, **bold**, *italic*, [links](https://…), bulleted and numbered lists, tables and > quotes. An image goes on a line of its own as ![caption](image:<id>). A chart goes in a ```chart block holding JSON {"type":"column","title":"…","categories":["…"],"series":[{"name":"…","values":[1,2]}]} (types: column, bar, line, area, pie, doughnut). Do not repeat the title as a heading, and put references in `references`, not here.',
        },
        references: {
          type: 'array',
          description: 'Sources the text cites as [1], [2]… in this order.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              author: { type: 'string' },
              publisher: { type: 'string' },
              date: { type: 'string' },
              url: { type: 'string' },
            },
            required: ['title'],
          },
        },
        seo: {
          type: 'object',
          description: 'For a blog post: added as a last page the user copies into their site.',
          properties: {
            title: { type: 'string', description: 'At most 60 characters.' },
            description: { type: 'string', description: '120 to 155 characters.' },
            slug: { type: 'string', description: 'Latin letters, digits and hyphens.' },
            keywords: { type: 'array', items: { type: 'string' } },
          },
        },
        style: {
          type: 'string',
          enum: ['formal', 'modern', 'academic'],
          description:
            'formal (default) for reports and letters, modern for blogs, academic for papers.',
        },
        accent_color: { type: 'string', description: 'A brand color as #RRGGBB.' },
        logo_image_id: { type: 'string', description: `The logo for the cover. ${imageIdHint}` },
        cover: { type: 'boolean', description: 'A cover page; on by default.' },
        toc: {
          type: 'boolean',
          description: 'A table of contents; on by default when there are four or more sections.',
        },
        version: {
          type: 'integer',
          minimum: 1,
          description: '1 for the first file, then 2, 3… for each revised file in this chat.',
        },
        direction: {
          type: 'string',
          enum: ['rtl', 'ltr'],
          description:
            'Only for a document in a left-to-right language; worked out from the text otherwise.',
        },
      },
      required: ['title', 'markdown'],
    },
    responseFormat: 'content_and_artifact',
  },
  [OfficeTools.slides]: {
    name: OfficeTools.slides,
    description: `Builds a professional PowerPoint (.pptx) deck the user can edit: 16:9, right to left for Persian (the first column on the right), every text in Vazirmatn, a consistent design in one of five styles, the user's logo on every slide with its brand color, native editable charts, images where the user wants them, and speaker notes. Text sizes follow the amount of text, so keep each slide to one idea and at most six short bullets. Plan the slides with the user before calling it. After building, tell the user, in their language, that the deck uses the free Vazirmatn font, which PowerPoint shows as designed once it is installed (https://github.com/rastikerdar/vazirmatn/releases), and that Google Slides has it built in. ${shared}`,
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The deck title.' },
        subtitle: { type: 'string' },
        author: { type: 'string', description: 'The presenter or organisation.' },
        style: {
          type: 'string',
          enum: DECK_STYLES,
          description:
            'minimal (default), corporate, education, dark or vibrant; follows the brand color when there is a logo.',
        },
        primary_color: { type: 'string', description: 'A brand color as #RRGGBB.' },
        accent_color: { type: 'string', description: 'A second color as #RRGGBB.' },
        logo_image_id: { type: 'string', description: `The logo for every slide. ${imageIdHint}` },
        version: {
          type: 'integer',
          minimum: 1,
          description: '1 for the first deck, then 2, 3… for each revised deck in this chat.',
        },
        direction: {
          type: 'string',
          enum: ['rtl', 'ltr'],
          description:
            'Only for a deck in a left-to-right language; worked out from the text otherwise.',
        },
        slides: {
          type: 'array',
          minItems: 1,
          description:
            'Every slide, in order: usually a title slide first and a closing slide last.',
          items: {
            type: 'object',
            properties: {
              layout: {
                type: 'string',
                enum: SLIDE_LAYOUTS,
                description:
                  'title, section (a divider), agenda, bullets, two_column, comparison (two options side by side), timeline (steps or dates), stats (2 to 4 key numbers), table, chart, quote, image (image beside text), image_full (one large image) or closing.',
              },
              title: { type: 'string' },
              subtitle: { type: 'string' },
              body: { type: 'string', description: 'A short paragraph.' },
              bullets: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Short points; one starting with "- " is a sub-point of the one before.',
              },
              columns: {
                type: 'array',
                description: 'two_column and comparison: two (at most three) columns.',
                items: {
                  type: 'object',
                  properties: {
                    heading: { type: 'string' },
                    bullets: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['heading', 'bullets'],
                },
              },
              items: {
                type: 'array',
                description:
                  'agenda: the topics as labels. timeline: a date or step as label with its text. stats: the number as label (۴۵٪) with what it means as text.',
                items: {
                  type: 'object',
                  properties: { label: { type: 'string' }, text: { type: 'string' } },
                  required: ['label'],
                },
              },
              table: {
                type: 'object',
                properties: {
                  headers: { type: 'array', items: { type: 'string' } },
                  rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
                },
                required: ['rows'],
              },
              chart: chartSchema,
              quote: {
                type: 'object',
                properties: { text: { type: 'string' }, author: { type: 'string' } },
                required: ['text'],
              },
              image_id: { type: 'string', description: imageIdHint },
              caption: { type: 'string' },
              notes: {
                type: 'string',
                description:
                  'Speaker notes: what to say, with the details that are not on the slide.',
              },
            },
            required: ['layout'],
          },
        },
      },
      required: ['title', 'slides'],
    },
    responseFormat: 'content_and_artifact',
  },
};
