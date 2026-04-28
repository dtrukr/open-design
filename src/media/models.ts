/**
 * Single source of truth for the media-generation model registry.
 *
 * Both the frontend (NewProjectPanel model pickers) and the daemon
 * (od media generate dispatcher) consume this list. When you add a new
 * model entry here, the picker shows it AND the daemon can route to it —
 * the unifying contract is "skills + metadata + prompt → code agent →
 * od media generate", and this file pins down what `--model` IDs the
 * agent is allowed to pass.
 *
 * The daemon imports the JSON view of this file via fs.readFile so we
 * don't fork the registry between frontend and Node code paths.
 */

import type { AudioKind, MediaAspect } from '../types';

export interface MediaModel {
  /** Stable ID used in metadata.imageModel / videoModel / audioModel. */
  id: string;
  /** Short label shown in pickers — usually equals id. */
  label: string;
  /** Vendor / context hint shown under the label. */
  hint: string;
  /**
   * Capabilities the agent may rely on when planning. Used downstream by
   * the dispatcher to decide which provider call to make.
   */
  caps?: string[];
}

export const IMAGE_MODELS: MediaModel[] = [
  { id: 'gpt-image-2', label: 'gpt-image-2', hint: 'OpenAI · default', caps: ['t2i', 'i2i', 'inpaint'] },
  { id: 'flux-1.1-pro', label: 'flux-1.1-pro', hint: 'Black Forest Labs', caps: ['t2i', 'i2i'] },
  { id: 'imagen-4', label: 'imagen-4', hint: 'Google', caps: ['t2i'] },
  { id: 'midjourney-v7', label: 'midjourney-v7', hint: 'Midjourney', caps: ['t2i'] },
];

export const VIDEO_MODELS: MediaModel[] = [
  { id: 'seedance-2', label: 'seedance-2', hint: 'ByteDance · default', caps: ['t2v', 'i2v'] },
  { id: 'kling-3', label: 'kling-3', hint: 'Kuaishou', caps: ['t2v', 'i2v'] },
  { id: 'kling-4', label: 'kling-4', hint: 'Kuaishou · latest', caps: ['t2v', 'i2v'] },
  { id: 'veo-3', label: 'veo-3', hint: 'Google', caps: ['t2v'] },
  { id: 'sora-2', label: 'sora-2', hint: 'OpenAI', caps: ['t2v'] },
];

export const AUDIO_MODELS_BY_KIND: Record<AudioKind, MediaModel[]> = {
  music: [
    { id: 'suno-v5', label: 'suno-v5', hint: 'Suno · default', caps: ['music'] },
    { id: 'udio-v2', label: 'udio-v2', hint: 'Udio', caps: ['music'] },
    { id: 'lyria-2', label: 'lyria-2', hint: 'Google', caps: ['music'] },
  ],
  speech: [
    { id: 'minimax-tts', label: 'minimax-tts', hint: 'MiniMax · default', caps: ['tts'] },
    { id: 'fish-speech-2', label: 'fish-speech-2', hint: 'FishAudio', caps: ['tts', 'voice-clone'] },
    { id: 'elevenlabs-v3', label: 'elevenlabs-v3', hint: 'ElevenLabs', caps: ['tts', 'voice-clone'] },
  ],
  sfx: [
    { id: 'elevenlabs-sfx', label: 'elevenlabs-sfx', hint: 'ElevenLabs SFX', caps: ['sfx'] },
    { id: 'audiocraft', label: 'audiocraft', hint: 'Meta · open', caps: ['sfx', 'music'] },
  ],
};

export const MEDIA_ASPECTS: MediaAspect[] = ['1:1', '16:9', '9:16', '4:3', '3:4'];

export const VIDEO_LENGTHS_SEC: number[] = [3, 5, 8, 10, 15, 30];
export const AUDIO_DURATIONS_SEC: number[] = [5, 10, 15, 30, 60, 120];

export const DEFAULT_IMAGE_MODEL = IMAGE_MODELS[0]!.id;
export const DEFAULT_VIDEO_MODEL = VIDEO_MODELS[0]!.id;
export const DEFAULT_AUDIO_MODEL: Record<AudioKind, string> = {
  music: AUDIO_MODELS_BY_KIND.music[0]!.id,
  speech: AUDIO_MODELS_BY_KIND.speech[0]!.id,
  sfx: AUDIO_MODELS_BY_KIND.sfx[0]!.id,
};

/**
 * Look up a model record across all surfaces by ID. Returns null if the
 * agent passes an unknown model — the dispatcher rejects with a clear
 * error so the agent re-plans instead of silently falling back.
 */
export function findMediaModel(id: string): MediaModel | null {
  const all: MediaModel[] = [
    ...IMAGE_MODELS,
    ...VIDEO_MODELS,
    ...AUDIO_MODELS_BY_KIND.music,
    ...AUDIO_MODELS_BY_KIND.speech,
    ...AUDIO_MODELS_BY_KIND.sfx,
  ];
  return all.find((m) => m.id === id) ?? null;
}

/** All model IDs grouped by surface, used for prompt-side disclosure. */
export function modelIdsBySurface(): {
  image: string[];
  video: string[];
  audio: { music: string[]; speech: string[]; sfx: string[] };
} {
  return {
    image: IMAGE_MODELS.map((m) => m.id),
    video: VIDEO_MODELS.map((m) => m.id),
    audio: {
      music: AUDIO_MODELS_BY_KIND.music.map((m) => m.id),
      speech: AUDIO_MODELS_BY_KIND.speech.map((m) => m.id),
      sfx: AUDIO_MODELS_BY_KIND.sfx.map((m) => m.id),
    },
  };
}
