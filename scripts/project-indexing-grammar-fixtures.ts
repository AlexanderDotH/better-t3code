export const projectIndexGrammarFixtures = [
  {
    grammar: "javascript",
    filePath: "fixture.js",
    source: "class Widget { run() { return helper(); } } function helper() { return 1; }",
    names: ["Widget", "run", "helper"],
  },
  {
    grammar: "typescript",
    filePath: "fixture.ts",
    source:
      "class Widget { run(): number { return helper(); } } function helper(): number { return 1; }",
    names: ["Widget", "run", "helper"],
  },
  {
    grammar: "tsx",
    filePath: "fixture.tsx",
    source: "export function Widget() { return <div/>; }",
    names: ["Widget"],
  },
  {
    grammar: "c_sharp",
    filePath: "fixture.cs",
    source:
      "class Widget { public int run() { return helper(); } public int helper() { return 1; } }",
    names: ["Widget", "run", "helper"],
  },
  {
    grammar: "java",
    filePath: "Fixture.java",
    source: "class Widget { int run() { return helper(); } int helper() { return 1; } }",
    names: ["Widget", "run", "helper"],
  },
  {
    grammar: "python",
    filePath: "fixture.py",
    source: "class Widget:\n def run(self):\n  return helper()\ndef helper():\n return 1\n",
    names: ["Widget", "run", "helper"],
  },
  {
    grammar: "go",
    filePath: "fixture.go",
    source:
      "package app\ntype Widget struct {}\nfunc (w Widget) Run() int { return helper() }\nfunc helper() int { return 1 }",
    names: ["Widget", "Run", "helper"],
  },
  {
    grammar: "rust",
    filePath: "fixture.rs",
    source:
      "struct Widget {}\nimpl Widget { fn run(&self) -> i32 { helper() } }\nfn helper() -> i32 { 1 }",
    names: ["Widget", "run", "helper"],
  },
  {
    grammar: "kotlin",
    filePath: "fixture.kt",
    source:
      "class Widget {\n fun run(): Int { return helper() }\n}\nfun helper(): Int { return 1 }\n",
    names: ["Widget", "run", "helper"],
  },
  {
    grammar: "c",
    filePath: "fixture.c",
    source:
      "struct Widget { int value; };\nint helper() { return 1; }\nint run() { return helper(); }",
    names: ["Widget", "run", "helper"],
  },
  {
    grammar: "cpp",
    filePath: "fixture.cpp",
    source: "class Widget { public: int run() { return helper(); } };\nint helper() { return 1; }",
    names: ["Widget", "run", "helper"],
  },
  {
    grammar: "ruby",
    filePath: "fixture.rb",
    source: "class Widget\n def run\n  helper()\n end\nend\ndef helper\n 1\nend",
    names: ["Widget", "run", "helper"],
  },
  {
    grammar: "php",
    filePath: "fixture.php",
    source:
      "<?php class Widget { function run() { return helper(); } } function helper() { return 1; }",
    names: ["Widget", "run", "helper"],
  },
  {
    grammar: "scala",
    filePath: "fixture.scala",
    source: "class Widget { def run(): Int = helper() }\ndef helper(): Int = 1",
    names: ["Widget", "run", "helper"],
  },
  {
    grammar: "bash",
    filePath: "fixture.sh",
    source: "helper() { echo hi; }\nrun() { helper; }",
    names: ["run", "helper"],
  },
  {
    grammar: "dart",
    filePath: "fixture.dart",
    source: "class Widget { int run() { return helper(); } }\nint helper() { return 1; }",
    names: ["Widget", "run", "helper"],
  },
  {
    grammar: "elixir",
    filePath: "fixture.ex",
    source: "defmodule Widget do\n def run(), do: helper()\n def helper(), do: 1\nend",
    names: ["Widget", "run", "helper"],
  },
  {
    grammar: "ocaml",
    filePath: "fixture.ml",
    source: "let helper x = x\nlet run x = helper x\n",
    names: ["run", "helper"],
  },
  {
    grammar: "rescript",
    filePath: "fixture.res",
    source: "let helper = x => x\nlet run = x => helper(x)\n",
    names: ["run", "helper"],
  },
  {
    grammar: "solidity",
    filePath: "fixture.sol",
    source:
      "contract Widget { function helper() public pure returns (uint) { return 1; } function run() public pure returns (uint) { return helper(); } }",
    names: ["Widget", "run", "helper"],
  },
  {
    grammar: "zig",
    filePath: "fixture.zig",
    source: "fn helper() i32 { return 1; }\nfn run() i32 { return helper(); }",
    names: ["run", "helper"],
  },
  {
    grammar: "objc",
    filePath: "fixture.m",
    source:
      "@interface Widget\n- (int)run;\n@end\n@implementation Widget\n- (int)run { return helper(); }\n@end\nint helper() { return 1; }",
    names: ["Widget", "run", "helper"],
  },
  {
    grammar: "elisp",
    filePath: "fixture.el",
    source: "(defun helper (x) x)\n(defun run (x) (helper x))",
    names: ["run", "helper"],
  },
] as const;
