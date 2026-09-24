const scriptSource = `class Service {
  static helper() { return 1; }
  field = Service.helper();
  run() {
    const result = Service.helper();
    const callback = () => { const nested = Service.helper(); return nested; };
    const anonymous = function () { const nestedAnonymous = Service.helper(); return nestedAnonymous; };
    callback();
    anonymous();
    return result;
  }
}`;

export const callOwnershipFixtures = [
  {
    language: "javascript",
    filePath: "Service.mjs",
    anonymousKind: "function",
    source: scriptSource,
  },
  {
    language: "typescript",
    filePath: "Service.ts",
    anonymousKind: "function",
    source: scriptSource,
  },
  {
    language: "csharp",
    filePath: "Service.cs",
    anonymousKind: "lambda",
    source: `using System;
class Service {
  static int helper() => 1;
  int field = helper();
  int run() {
    var result = helper();
    Func<int> callback = () => { var nested = helper(); return nested; };
    Func<int> anonymous = delegate { var nestedAnonymous = helper(); return nestedAnonymous; };
    callback();
    anonymous();
    return result;
  }
}`,
  },
  {
    language: "java",
    filePath: "Service.java",
    anonymousKind: "method",
    source: `import java.util.function.IntSupplier;
class Service {
  static int helper() { return 1; }
  int field = helper();
  int run() {
    int result = helper();
    IntSupplier callback = () -> { int nested = helper(); return nested; };
    IntSupplier anonymous = new IntSupplier() {
      public int getAsInt() { int nestedAnonymous = helper(); return nestedAnonymous; }
    };
    callback.getAsInt();
    anonymous.getAsInt();
    return result;
  }
}`,
  },
] as const;
