export type InterfaceCatalogLanguage = "en" | "de" | "fr";

export type InterfaceMessageTemplate =
  | string
  | Readonly<{
      one: string;
      other: string;
    }>;

type LocalizedMessage = readonly [
  en: InterfaceMessageTemplate,
  de: InterfaceMessageTemplate,
  fr: InterfaceMessageTemplate,
];

export interface LocalizedInterfaceCatalog<Key extends string> {
  readonly keys: readonly Key[];
  readonly messages: Readonly<
    Record<InterfaceCatalogLanguage, Readonly<Record<Key, InterfaceMessageTemplate>>>
  >;
}

export function defineLocalizedInterfaceCatalog<
  const Entries extends Readonly<Record<string, LocalizedMessage>>,
>(entries: Entries): LocalizedInterfaceCatalog<keyof Entries & string> {
  type Key = keyof Entries & string;
  const keys = Object.keys(entries) as Key[];
  const messages = {
    en: {} as Record<Key, InterfaceMessageTemplate>,
    de: {} as Record<Key, InterfaceMessageTemplate>,
    fr: {} as Record<Key, InterfaceMessageTemplate>,
  };
  for (const key of keys) {
    const localized = entries[key];
    if (localized === undefined) continue;
    messages.en[key] = localized[0];
    messages.de[key] = localized[1];
    messages.fr[key] = localized[2];
  }
  return { keys: Object.freeze(keys), messages };
}
