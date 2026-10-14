// Everything imported here has no SillyTavern.getContext() equivalent (see the shared
// guidelines, C1): selected_world_info, world_info, the chat lorebook metadata key,
// getCharaFilename, debounce and debounce_timeout.
import { selected_world_info, world_info, METADATA_KEY as CHAT_LORE_METADATA_KEY } from '../../../world-info.js';
import { debounce, getCharaFilename } from '../../../utils.js';
import { debounce_timeout } from '../../../constants.js';

const MODULE_NAME = 'presetScopedLorebooks';
const EXT_PATH = 'third-party/sillytavern-preset-scoped-lorebooks';
const BLOCK_ID = 'presetScopedLorebooksBlock';

// Path inside a Chat Completion preset's `extensions` object. Holds the list of book names owned
// by that preset, so the binding travels with an exported/imported preset file.
const PRESET_FIELD_PATH = 'presetScopedLorebooks.books';
const PRESET_API_ID = 'openai';

/**
 * scopedBooks: every book that has ever been owned by a preset. Kept separately from the
 * per-preset lists so that deleting the owning preset leaves the book hidden instead of
 * silently turning it back into a regular global book. Only an explicit "release" removes it.
 */
const DEFAULT_SETTINGS = {
    scopedBooks: [],
};

function ensureSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    extensionSettings[MODULE_NAME] ??= {};
    extensionSettings[MODULE_NAME].scopedBooks ??= [...DEFAULT_SETTINGS.scopedBooks];
    return extensionSettings[MODULE_NAME];
}

function getRegistry() {
    return ensureSettings().scopedBooks;
}

function addToRegistry(books) {
    const registry = getRegistry();
    const missing = books.filter(book => !registry.includes(book));
    if (missing.length === 0) {
        return;
    }
    registry.push(...missing);
    SillyTavern.getContext().saveSettingsDebounced();
}

function removeFromRegistry(book) {
    const settings = ensureSettings();
    settings.scopedBooks = settings.scopedBooks.filter(x => x !== book);
    SillyTavern.getContext().saveSettingsDebounced();
}

function getPresetManager() {
    return SillyTavern.getContext().getPresetManager(PRESET_API_ID);
}

function normalizeBooks(value) {
    return Array.isArray(value) ? value.filter(x => typeof x === 'string' && x) : [];
}

/**
 * @param {string} [presetName] Defaults to the currently selected Chat Completion preset.
 * @returns {string[]}
 */
function getOwnedBooks(presetName) {
    const presetManager = getPresetManager();
    if (!presetManager) {
        return [];
    }
    return normalizeBooks(presetManager.readPresetExtensionField({ name: presetName, path: PRESET_FIELD_PATH }));
}

async function setOwnedBooks(books) {
    await getPresetManager()?.writePresetExtensionField({ path: PRESET_FIELD_PATH, value: books });
}

/**
 * @returns {Map<string, string[]>} book name → names of the presets that own it
 */
function getOwnersByBook() {
    const owners = new Map();
    const presetManager = getPresetManager();
    if (!presetManager) {
        return owners;
    }
    for (const presetName of presetManager.getAllPresets()) {
        for (const book of getOwnedBooks(presetName)) {
            if (!owners.has(book)) {
                owners.set(book, []);
            }
            owners.get(book).push(presetName);
        }
    }
    return owners;
}

/**
 * Registry plus every book currently claimed by any preset. Claims missing from the registry
 * (e.g. from an imported preset) are added to it, so they stay hidden if that preset is deleted.
 * @returns {Set<string>}
 */
function getScopedBooks() {
    const claimed = [...getOwnersByBook().keys()];
    addToRegistry(claimed);
    return new Set(getRegistry());
}

/**
 * Scoped books that must not be used right now: everything scoped that the selected preset
 * doesn't own. Outside Chat Completion no prompt preset is in play, so all scoped books are hidden.
 * @returns {Set<string>}
 */
function getSuppressedBooks() {
    const scoped = getScopedBooks();
    if (scoped.size === 0) {
        return scoped;
    }
    const { mainApi } = SillyTavern.getContext();
    const allowed = new Set(mainApi === PRESET_API_ID ? getOwnedBooks() : []);
    return new Set([...scoped].filter(book => !allowed.has(book)));
}

/**
 * Core skips loading a chat/persona/character-bound book through those sources when the same book
 * is also selected globally. When we drop such a book from global lore, it must go to the array
 * core would otherwise have used, or it would vanish from that binding too. Precedence mirrors
 * core's own dedup: chat > persona > character.
 */
function getAlternateLoreArray(book, lore) {
    const { chatMetadata, powerUserSettings, characters, characterId } = SillyTavern.getContext();
    if (chatMetadata?.[CHAT_LORE_METADATA_KEY] === book) {
        return lore.chatLore;
    }
    if (powerUserSettings?.persona_description_lorebook === book) {
        return lore.personaLore;
    }
    const character = characters?.[characterId];
    if (character) {
        if (character.data?.extensions?.world === book) {
            return lore.characterLore;
        }
        const extraCharLore = world_info.charLore?.find(x => x.name === getCharaFilename(characterId));
        if (extraCharLore?.extraBooks?.includes(book)) {
            return lore.characterLore;
        }
    }
    return null;
}

/**
 * WORLDINFO_ENTRIES_LOADED listener. Core passes the live arrays it is about to merge and scan,
 * so removing entries here keeps them out of the prompt (and out of dry runs / token counts).
 * @param {{globalLore: object[], characterLore: object[], chatLore: object[], personaLore: object[]}} lore
 */
function onEntriesLoaded(lore) {
    try {
        if (!Array.isArray(lore?.globalLore) || lore.globalLore.length === 0) {
            return;
        }
        const suppressed = getSuppressedBooks();
        if (suppressed.size === 0) {
            return;
        }
        let removed = 0;
        let moved = 0;
        for (let i = lore.globalLore.length - 1; i >= 0; i--) {
            const entry = lore.globalLore[i];
            if (!suppressed.has(entry.world)) {
                continue;
            }
            lore.globalLore.splice(i, 1);
            const target = getAlternateLoreArray(entry.world, lore);
            if (Array.isArray(target)) {
                target.push(entry);
                moved++;
            } else {
                removed++;
            }
        }
        if (removed || moved) {
            console.debug(`[Preset-Scoped Lorebooks] Removed ${removed} global entries, moved ${moved} to their non-global binding`, [...suppressed]);
        }
    } catch (error) {
        console.error('[Preset-Scoped Lorebooks] Failed to filter world info entries', error);
    }
}

async function renderBlock() {
    const $block = $(`#${BLOCK_ID}`);
    if (!$block.length) {
        return;
    }
    const { t, getWorldInfoNames, renderExtensionTemplateAsync } = SillyTavern.getContext();
    const worldNames = getWorldInfoNames();
    const owned = getOwnedBooks();
    const ownersByBook = getOwnersByBook();
    const scoped = [...getScopedBooks()].sort((a, b) => a.localeCompare(b));

    const $select = $block.find('#presetScopedLorebooksAddSelect').empty();
    const $addBtn = $block.find('#presetScopedLorebooksAddBtn');
    const addable = worldNames.filter(book => !owned.includes(book));
    if (addable.length === 0) {
        $select.append($('<option>').val('').text(t`No more lorebooks to add`));
        $select.prop('disabled', true);
        $addBtn.addClass('disabled');
    } else {
        $select.append($('<option>').val('').text(t`Select a lorebook…`));
        for (const book of addable) {
            $select.append($('<option>').val(book).text(book));
        }
        $select.prop('disabled', false);
        $addBtn.removeClass('disabled');
    }

    const $owned = $block.find('#presetScopedLorebooksOwned').empty();
    $block.find('#presetScopedLorebooksOwnedEmpty').toggle(owned.length === 0);
    for (const book of owned) {
        $owned.append(await renderExtensionTemplateAsync(EXT_PATH, 'owned-row', {
            book,
            missing: !worldNames.includes(book),
            notGlobal: !selected_world_info.includes(book),
        }));
    }

    const $all = $block.find('#presetScopedLorebooksAll').empty();
    $block.find('#presetScopedLorebooksAllEmpty').toggle(scoped.length === 0);
    for (const book of scoped) {
        const owners = ownersByBook.get(book) ?? [];
        $all.append(await renderExtensionTemplateAsync(EXT_PATH, 'scoped-row', {
            book,
            missing: !worldNames.includes(book),
            owned: owners.length > 0,
            owners: owners.length > 0 ? t`Owned by: ${owners.join(', ')}` : t`No owner — always hidden`,
            canRelease: owners.length === 0,
        }));
    }
}

const renderBlockDebounced = debounce(renderBlock, debounce_timeout.short);

async function onAddClick() {
    if ($(this).hasClass('disabled')) {
        return;
    }
    const book = String($('#presetScopedLorebooksAddSelect').val() || '');
    if (!book) {
        return;
    }
    const owned = getOwnedBooks();
    if (!owned.includes(book)) {
        addToRegistry([book]);
        await setOwnedBooks([...owned, book]);
    }
    await renderBlock();
}

async function onRemoveClick() {
    const book = $(this).closest('.preset-scoped-lorebooks-row').data('book');
    await setOwnedBooks(getOwnedBooks().filter(x => x !== book));
    await renderBlock();
}

async function onReleaseClick() {
    const book = $(this).closest('.preset-scoped-lorebooks-row').data('book');
    if (getOwnersByBook().has(book)) {
        return;
    }
    removeFromRegistry(book);
    await renderBlock();
}

async function buildBlock() {
    const { renderExtensionTemplateAsync } = SillyTavern.getContext();
    const $anchor = $('#settings_preset_openai').parent();
    if (!$anchor.length) {
        console.warn('[Preset-Scoped Lorebooks] Chat Completion preset selector not found, UI not added');
        return;
    }
    const $block = $(await renderExtensionTemplateAsync(EXT_PATH, 'panel'));
    $anchor.after($block);

    $block.on('click', '#presetScopedLorebooksAddBtn', onAddClick);
    $block.on('click', '.preset-scoped-lorebooks-remove', onRemoveClick);
    $block.on('click', '.preset-scoped-lorebooks-release', onReleaseClick);
    $block.on('inline-drawer-toggle', () => renderBlockDebounced());
}

export async function init() {
    ensureSettings();
    await buildBlock();
    const { eventSource, event_types } = SillyTavern.getContext();
    eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, onEntriesLoaded);
    for (const eventType of [
        event_types.APP_READY,
        event_types.OAI_PRESET_CHANGED_AFTER,
        event_types.PRESET_RENAMED,
        event_types.PRESET_DELETED,
        event_types.MAIN_API_CHANGED,
        event_types.WORLDINFO_SETTINGS_UPDATED,
    ]) {
        if (eventType) {
            eventSource.on(eventType, () => renderBlockDebounced());
        }
    }
}

jQuery(async () => {
    await init();
});
