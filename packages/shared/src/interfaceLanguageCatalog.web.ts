import { defineLocalizedInterfaceCatalog } from "./interfaceLanguageCatalog.types.ts";

/** Web-only copy lives here. Shared settings and Knowledge Graph copy stay in their domain catalogs. */
export const webInterfaceCatalog = defineLocalizedInterfaceCatalog({});

export type WebInterfaceMessageKey = (typeof webInterfaceCatalog.keys)[number];
