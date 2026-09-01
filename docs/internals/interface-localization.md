# Interface localization

T3 Code localizes app-owned interface copy through one typed catalog system shared by web,
desktop, and mobile. The product behavior is described in
[Interface language](../user/interface-language.md); this document defines the engineering
contract.

## Catalog ownership

Domain catalogs live in `packages/shared/src/interfaceLanguageCatalog.*.ts`. Each entry is created
with `defineLocalizedInterfaceCatalog` and provides an English, German, and French template in one
tuple. The aggregate catalog in `interfaceLanguageCatalog.ts` derives `InterfaceMessageKey`, rejects
duplicate ownership at startup, and exposes one immutable key list.

Use the narrowest domain catalog that owns the copy. Components receive a typed translator and
render prepared strings; they do not choose a locale or carry parallel English fallbacks. Shared
view-model code may accept an `InterfaceTranslator` when it prepares user-visible labels. Provider
adapters, orchestration events, and persistence records do not contain translated presentation
copy.

Catalogs own only T3-authored interface language. Keep provider output, user input, repository
content, code, terminal output, URLs, paths, commands, identifiers, telemetry values, and raw error
payloads outside the catalog. When T3 copy needs one of those values, use an interpolation
placeholder and preserve the value byte-for-byte.

## Locale resolution and formatting

`InterfaceLocalePreferenceV1` supports `system`, `en`, `de`, and `fr`. Explicit choices resolve to
`en-US`, `de-DE`, and `fr-FR`. System negotiation preserves supported English locales plus
`de-DE`, `de-AT`, `de-CH`, and `fr-FR`; unsupported or invalid locales fall back to `en-US`.

`InterfaceTranslator` owns message selection and ICU-backed number, list, plural, and date
formatting. Do not format a translated value with a separate hard-coded locale. Plural templates
provide `one` and `other` forms, and interpolation uses named `{{placeholder}}` values.

## V1 synchronization and mixed versions

`InterfaceLocaleSyncRecordV1` contains:

- `version: 1`;
- the locale preference;
- a monotonic `updatedAt` value;
- a stable `updateId` tie-breaker.

Synchronization uses last-write-wins ordering. Greater `updatedAt` wins; equal timestamps are
ordered lexicographically by `updateId`. Clients retain pending writes while an environment is
disconnected and report deferred, failed, and unsupported environments instead of claiming that a
write succeeded.

Environment settings version 5 carries the V1 record and all four preferences. Version 4 carries
the legacy `system`, `en`, or `de` record. A V1 English, German, or System choice is mirrored into
the legacy record. French is never projected into the legacy schema, so it cannot overwrite an
older environment with a value that environment cannot decode. A newer legacy record can still
win and is promoted to V1 without losing its timestamp or update ID.

Persist both records while mixed-version clients exist. Decoders treat either record as optional,
repair a missing compatible mirror, and never let a stale record replace a newer one.

## Quality gates

Every catalog change must prove:

- every key has a non-empty English, German, and French template;
- placeholders match across all locales and remain intact after interpolation;
- singular and plural forms select correctly for the resolved locale;
- unsupported locales fall back to English;
- `de-DE`, `de-AT`, `de-CH`, and `fr-FR` format representative numbers, dates, and lists through
  `Intl`;
- long German and French labels fit representative layouts;
- pseudo-localization expands T3-owned copy while preserving interpolated external values;
- app-owned errors and empty states use typed fallbacks while raw external payloads remain
  unchanged.

Repository policy tests scan production web, desktop, and mobile source for visible string
literals in JSX, accessibility properties, menus, dialogs, notifications, and other presentation
fields. Exceptions must name an exact non-linguistic value and explain why it is not interface copy.
Do not add file-wide exclusions to make a policy test pass.

The principal gates are:

- `packages/shared/src/interfaceLanguage.test.ts` for resolution, formatting, fallback,
  interpolation, and pseudo-localization;
- domain `interfaceLanguageCatalog.*.test.ts` files for key completeness and placeholder parity;
- `apps/web/src/interface-localization-policy.test.ts`;
- `apps/desktop/src/interface-localization-policy.test.ts`;
- `apps/mobile/src/localization/mobile-localization-policy.test.ts`.

Run the focused catalog and policy tests for the surfaces a change affects, plus the affected
package typechecks. Missing keys, duplicate ownership, placeholder drift, or new hard-coded visible
copy block the change.
