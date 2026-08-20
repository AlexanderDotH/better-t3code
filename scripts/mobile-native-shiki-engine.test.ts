// @effect-diagnostics nodeBuiltinImport:off - verifies an installed native dependency patch.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

const shikiEngineCmake = NodeFS.readFileSync(
  new URL(
    "../apps/mobile/node_modules/react-native-shiki-engine/android/CMakeLists.txt",
    import.meta.url,
  ),
  "utf8",
);

describe("react-native-shiki-engine Android integration", () => {
  it("links the packaged ABI library without consulting the host", () => {
    expect(shikiEngineCmake).toMatch(/add_library\(shiki_engine_oniguruma SHARED IMPORTED\)/);
    expect(shikiEngineCmake).toMatch(
      /set_target_properties\(shiki_engine_oniguruma PROPERTIES\s+IMPORTED_LOCATION "\$\{CMAKE_CURRENT_SOURCE_DIR\}\/src\/main\/jniLibs\/\$\{ANDROID_ABI\}\/libonig\.so"\s*\)/,
    );
    expect(shikiEngineCmake).toMatch(
      /target_link_libraries\(react-native-shiki-engine\s+shiki_engine_oniguruma/,
    );
    expect(shikiEngineCmake).not.toMatch(/find_library\(ONIG_LIB/);
  });
});
