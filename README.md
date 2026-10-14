# Preset-Scoped Lorebooks

Lets a Chat Completion preset "own" global lorebooks. An owned lorebook is only used while one of
its owning presets is selected; under any other preset it is ignored, even though it stays selected
in the global World Info list. Lorebooks that no preset owns work exactly as before.

Useful when a prompt preset keeps part of its data in global lorebooks and that data must not leak
into generations made with other presets.

## How it works

SillyTavern's global lorebook selection is a single account-wide list that knows nothing about
presets. This extension doesn't change that list. Instead, every time World Info is scanned, it
removes the entries of scoped lorebooks that the current preset doesn't own, before the scanner sees
them. Your global selection is never modified, and switching presets takes effect on the next
generation (and in prompt previews / token counts) with no extra steps.

- Ownership is stored inside the preset itself, so it is included when you export the preset and
  restored when you import it. Renaming a preset keeps its lorebooks.
- Once a lorebook has been owned by any preset, it is **scoped**. A scoped lorebook stays hidden
  under presets that don't own it, even if you remove it from its last owning preset or delete that
  preset. To turn it back into a regular global lorebook, use **Release** (see below).
- When a non–Chat Completion API is selected, no prompt preset is in play, so all scoped lorebooks
  are hidden.
- If a scoped lorebook is also bound to the current chat, persona or character, it is still used
  through that binding: only its *global* activation is suppressed.

## Configuration

Open **AI Response Configuration** (Chat Completion) and expand **Preset Lorebooks** under the preset
selector.

- **Owned by the current preset** — add lorebooks from the dropdown, or remove them with ✕.
  An info icon means the lorebook isn't selected globally, so owning it currently has no effect.
- **All scoped lorebooks** — every scoped lorebook and the presets that own it. Lorebooks with no
  owner are always hidden; the unlock button releases them back to regular global lorebooks.

Changes to ownership are saved to the preset immediately; you don't need to click "Update preset".

## Extension compatibility

Works alongside [Forced World Info](https://github.com/Laplace-Lapis/sillytavern-forced-world-info):
entries of a lorebook hidden by this extension are shown there as belonging to an inactive book, and
forcing them has no effect.

## Security guarantees

This extension makes no network requests of its own. It only reads and writes its own field in Chat
Completion presets and its own extension settings, and only removes World Info entries from the
current scan; it never edits lorebook contents or outgoing/incoming messages.

## How to install

Use this URL with the extension installer: `https://github.com/Laplace-Lapis/sillytavern-preset-scoped-lorebooks`

## License

AGPLv3

## Changelog

- 1.0.0 — Initial release.
