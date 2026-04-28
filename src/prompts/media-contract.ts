/**
 * Media generation contract. Pinned LAST in the system prompt for
 * image / video / audio surfaces so its hard rules win over softer
 * wording in earlier layers ("emit an artifact tag", "use the Write
 * tool", etc.).
 *
 * The contract is the unifying primitive: for media surfaces the agent
 * does NOT fabricate bytes inside `<artifact>` (it can't — bytes are
 * binary). Instead it shells out to a single command — `od media
 * generate` — that the daemon dispatches per (surface, model). The
 * daemon writes the resulting file into the project, the FileViewer
 * picks it up automatically, and the agent only narrates what it did
 * and references the returned filename.
 *
 * The contract is intentionally tool-name-agnostic: it works on any
 * code-agent CLI that has shell access (Claude Code's Bash, Codex's
 * shell, Gemini's exec, OpenCode, Cursor Agent, Qwen — all of them).
 * That's why we keep it as text-driven shell calls rather than custom
 * tool definitions.
 */
import {
  AUDIO_MODELS_BY_KIND,
  IMAGE_MODELS,
  VIDEO_MODELS,
} from '../media/models';

function fmtList(ids: string[]): string {
  return ids.map((id) => `\`${id}\``).join(', ');
}

const IMAGE_IDS = fmtList(IMAGE_MODELS.map((m) => m.id));
const VIDEO_IDS = fmtList(VIDEO_MODELS.map((m) => m.id));
const AUDIO_MUSIC_IDS = fmtList(AUDIO_MODELS_BY_KIND.music.map((m) => m.id));
const AUDIO_SPEECH_IDS = fmtList(AUDIO_MODELS_BY_KIND.speech.map((m) => m.id));
const AUDIO_SFX_IDS = fmtList(AUDIO_MODELS_BY_KIND.sfx.map((m) => m.id));

export const MEDIA_GENERATION_CONTRACT = `
---

## Media generation contract (load-bearing — overrides softer wording above)

This project is a **non-web** surface (image / video / audio). The unifying
contract is: skill workflow + project metadata tell you WHAT to make; one
shell command — \`od media generate\` — is HOW you actually produce bytes.
Do not try to embed binary content inside \`<artifact>\` tags, and do not
write image/video/audio bytes by hand. Always call out to the dispatcher.

### Environment the daemon injected for you

The daemon spawns you with these env vars set (verify with \`echo\`):

- \`OD_BIN\`         — absolute path to the \`od\` CLI script. Run with \`node "$OD_BIN" …\`.
- \`OD_PROJECT_ID\`  — the active project's id. Pass it as \`--project "$OD_PROJECT_ID"\`.
- \`OD_PROJECT_DIR\` — the project's files folder (your cwd). Generated files land here.
- \`OD_DAEMON_URL\`  — base URL of the local daemon, e.g. \`http://127.0.0.1:7456\`.

If any of these are unset, the user is running you outside the OD daemon —
ask them to relaunch from the OD app (or pass the values explicitly).

### Invocation

Run via your shell tool (Bash on Claude Code, exec on Codex/Gemini, etc.):

\`\`\`bash
node "$OD_BIN" media generate \\
  --project "$OD_PROJECT_ID" \\
  --surface <image|video|audio> \\
  --model <model-id> \\
  --output <filename> \\
  --prompt "<full prompt>" \\
  [--aspect 1:1|16:9|9:16|4:3|3:4] \\
  [--length <seconds>]              # video only
  [--duration <seconds>]            # audio only
  [--audio-kind music|speech|sfx]   # audio only
  [--voice <voice-id>]              # audio:speech only
\`\`\`

The command prints a single line of JSON describing the written file:

\`\`\`json
{ "file": { "name": "poster.png", "size": 12345, "kind": "image", "mime": "image/png", ... } }
\`\`\`

Save the \`file.name\` and reference it in your reply ("I generated
\`poster.png\`."). The user's FileViewer renders it automatically.

### Allowed model IDs (per surface)

- **image**:   ${IMAGE_IDS}
- **video**:   ${VIDEO_IDS}
- **audio · music**:  ${AUDIO_MUSIC_IDS}
- **audio · speech**: ${AUDIO_SPEECH_IDS}
- **audio · sfx**:    ${AUDIO_SFX_IDS}

If the user requests a model that is not in this list, surface a warning
in your reply and either (a) ask them to pick a registered ID or (b)
proceed with the project metadata's default model and explain the
substitution. Do not silently fall back.

### Workflow rules

1. **Read project metadata first.** The "Project metadata" block above
   tells you the user's pre-selected model, aspect, length, voice, audio
   kind, etc. Treat those as authoritative defaults — only override if
   the user's chat message explicitly contradicts them.
2. **One discovery turn before generating.** Even with metadata defaults
   present, restate what you're about to make and ask one targeted
   question if anything is ambiguous (subject, mood, brand, voice). The
   discovery rules from the philosophy layer still apply — emit a
   question form on turn 1 unless the user's prompt already pins every
   variable.
3. **Generate by shell, narrate in chat.** When you actually invoke
   \`od media generate\`, do it inside a clearly-labelled tool call. After
   it returns, write a short reply: what was produced, the filename,
   and any notes (model substitutions, retries, follow-up suggestions).
4. **Iterate by re-running.** To revise, call \`od media generate\` again
   with a new \`--output\` filename (or omit \`--output\` to auto-name).
   Don't try to "edit" generated bytes by hand — re-generate and let the
   user pick which version to keep.
5. **Don't emit \`<artifact>\` blocks for media.** They're for HTML/text
   artifacts. For media surfaces your "artifact" is the file written by
   the dispatcher. The artifact lint and PDF-stitching layers don't
   apply.
6. **Filenames are slugged.** The dispatcher sanitises filenames; pick
   short, descriptive ones (\`hero-shot.png\`, \`intro-jingle.mp3\`,
   \`teaser-15s.mp4\`) so the user's file list stays readable.

### Stub-provider note

The provider integrations behind specific models (gpt-image-2,
seedance-2, suno-v5, …) may still be stubs in this build — the
dispatcher will return success and a placeholder file. That's fine: the
contract you follow is the same; the bytes get sharper as real
provider integrations land. The user has been told to expect this.
`;
