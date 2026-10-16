import { z } from 'zod';

const draftSchema = z.object({
  url: z.string().max(2048),
  video: z
    .object({
      token: z.string().uuid(),
      id: z.string().regex(/^[\w-]{11}$/),
      url: z.string().url(),
      title: z.string(),
      channel: z.string(),
      duration: z.number().positive().max(86_400),
      thumbnail: z.string(),
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .nullable(),
  startTime: z.string().max(32),
  endTime: z.string().max(32),
  jobId: z.string().uuid().nullable(),
  view: z.enum(['create', 'downloads']),
});
type Draft = z.infer<typeof draftSchema>;
const empty: Draft = {
  url: '',
  video: null,
  startTime: '0:00',
  endTime: '2:20',
  jobId: null,
  view: 'create',
};

export function readDraft(): Draft {
  try {
    return draftSchema.parse(
      JSON.parse(localStorage.getItem('postready-draft') || 'null'),
    );
  } catch {
    return empty;
  }
}

export function saveDraft(draft: Draft) {
  try {
    localStorage.setItem('postready-draft', JSON.stringify(draft));
  } catch {
    /* Processing and editing can continue without storage. */
  }
}
