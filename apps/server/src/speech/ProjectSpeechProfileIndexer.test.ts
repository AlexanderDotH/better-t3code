import { describe, expect, it } from "vite-plus/test";

import {
  buildBasicProjectSpeechProfileContent,
  buildIndexedProjectSpeechProfileContent,
  type ProjectSpeechProfileInput,
} from "./ProjectSpeechProfileIndexer.ts";

function makeInput(overrides: Partial<ProjectSpeechProfileInput> = {}): ProjectSpeechProfileInput {
  return {
    projectTitle: "T3 Speech",
    workspaceRoot: "/work/t3-speech",
    workspaceEntries: [],
    textFiles: [],
    ...overrides,
  };
}

describe("ProjectSpeechProfileIndexer", () => {
  it("indexes project, package, heading, file, and internal identifier terminology", () => {
    const result = buildIndexedProjectSpeechProfileContent(
      makeInput({
        repositoryIdentity: {
          canonicalKey: "github.com/t3tools/t3-speech",
          locator: {
            source: "git-remote",
            remoteName: "origin",
            remoteUrl: "https://github.com/t3tools/t3-speech.git",
          },
          displayName: "t3tools/t3-speech",
          owner: "t3tools",
          name: "t3-speech",
          provider: "github",
        },
        workspaceEntries: [
          { path: "package.json", kind: "file" },
          { path: "README.md", kind: "file" },
          { path: "src/speech/ProjectSpeechProfileIndexer.ts", kind: "file" },
          { path: "src/hooks/useProjectSpeechProfile.ts", kind: "file" },
          { path: "src/state/thread-outbox.ts", kind: "file" },
        ],
        textFiles: [
          {
            path: "package.json",
            contents: JSON.stringify({
              name: "@t3tools/speech-server",
              dependencies: { effect: "latest", react: "latest" },
              devDependencies: { typescript: "latest", vite: "latest" },
            }),
          },
          {
            path: "README.md",
            contents: "# T3 Speech\n\n## Realtime Dictation Pipeline\n",
          },
          {
            path: "src/speech/ProjectSpeechProfileIndexer.ts",
            contents:
              "export class AssemblyAIStreamingToken {}\nconst profile = useProjectSpeechProfile();\nconst queue = 'thread-outbox';\n",
          },
        ],
      }),
    );

    expect(result.keyterms).toEqual(
      expect.arrayContaining([
        "T3 Speech",
        "@t3tools/speech-server",
        "Realtime Dictation Pipeline",
        "ProjectSpeechProfileIndexer",
        "AssemblyAIStreamingToken",
        "useProjectSpeechProfile",
        "thread-outbox",
      ]),
    );
    expect(result.technologies).toEqual(
      expect.arrayContaining(["Effect", "React", "TypeScript", "Vite"]),
    );
    expect(result.contextPrompt).toContain("T3 Speech");
    expect(result.contextPrompt).toContain("Software-development dictation");
    expect(result.contextPrompt).not.toMatch(/keywords?:/i);
  });

  it("is deterministic across input ordering and does not mutate frozen inputs", () => {
    const workspaceEntries = Object.freeze([
      Object.freeze({ path: "src/ZetaRouter.ts", kind: "file" as const }),
      Object.freeze({ path: "src/AlphaBroker.ts", kind: "file" as const }),
    ]);
    const textFiles = Object.freeze([
      Object.freeze({ path: "src/ZetaRouter.ts", contents: "class ZetaRouter {}" }),
      Object.freeze({ path: "src/AlphaBroker.ts", contents: "class AlphaBroker {}" }),
    ]);
    const input = makeInput({ workspaceEntries, textFiles });
    const reordered = makeInput({
      workspaceEntries: [...workspaceEntries].toReversed(),
      textFiles: [...textFiles].toReversed(),
    });

    expect(buildIndexedProjectSpeechProfileContent(input)).toEqual(
      buildIndexedProjectSpeechProfileContent(reordered),
    );
    expect(buildIndexedProjectSpeechProfileContent(input)).toEqual(
      buildIndexedProjectSpeechProfileContent(input),
    );
  });

  it("preserves source casing while normalizing and deduplicating case-insensitively", () => {
    const result = buildIndexedProjectSpeechProfileContent(
      makeInput({
        projectTitle: "  Acme   Voice  ",
        workspaceEntries: [{ path: "src/SpeechEngine.ts", kind: "file" }],
        textFiles: [
          {
            path: "src/SpeechEngine.ts",
            contents:
              "const speechEngine = new SpeechEngine();\nconst SPEECHENGINE = SpeechEngine;",
          },
        ],
      }),
    );
    const normalized = result.keyterms.map((term) => term.toLowerCase());

    expect(result.keyterms).toContain("Acme Voice");
    expect(result.keyterms).toContain("SpeechEngine");
    expect(normalized.filter((term) => term === "speechengine")).toHaveLength(1);
    expect(new Set(normalized).size).toBe(result.keyterms.length);
  });

  it("bounds prompt and keyterm output", () => {
    const identifiers = Array.from(
      { length: 180 },
      (_, index) => `InternalComponent${String(index).padStart(3, "0")}`,
    ).join(" ");
    const overlongIdentifier = `Internal${"Component".repeat(8)}`;
    const result = buildIndexedProjectSpeechProfileContent(
      makeInput({
        projectTitle: "P".repeat(200),
        workspaceRoot: "/work/bounded-profile",
        textFiles: [
          {
            path: "src/components.ts",
            contents: `${identifiers} ${overlongIdentifier}`,
          },
        ],
      }),
    );

    expect(result.contextPrompt.length).toBeLessThanOrEqual(1_750);
    expect(result.keyterms.length).toBeLessThanOrEqual(100);
    expect(result.keyterms.every((term) => term.length <= 50)).toBe(true);
    expect(result.keyterms).not.toContain(overlongIdentifier);
  });

  it("excludes common terms, secrets, URLs, hashes, UUIDs, and ignored paths", () => {
    const result = buildIndexedProjectSpeechProfileContent(
      makeInput({
        workspaceEntries: [
          { path: "README.md", kind: "file" },
          { path: "src/index.ts", kind: "file" },
          { path: "src/SafeRequestBroker.ts", kind: "file" },
          { path: "node_modules/pkg/VendorSecretWidget.ts", kind: "file" },
          { path: "vendor/ThirdPartyPaymentKernel.ts", kind: "file" },
          { path: "dist/GeneratedPortal.js", kind: "file" },
          { path: "build/ReleaseArtifact.ts", kind: "file" },
          { path: "src/generated/GeneratedGraph.ts", kind: "file" },
        ],
        textFiles: [
          {
            path: "README.md",
            contents:
              "# Getting Started\n## Installation\nVisit https://example.com/HiddenPortal\n",
          },
          {
            path: "src/SafeRequestBroker.ts",
            contents: [
              "class SafeRequestBroker {}",
              'const apiKey = "sk-live-SuperSecretCredential123456";',
              'const commit = "0123456789abcdef0123456789abcdef01234567";',
              'const requestId = "123e4567-e89b-12d3-a456-426614174000";',
              'const docs = "https://example.com/HiddenPortal";',
            ].join("\n"),
          },
          {
            path: "node_modules/pkg/VendorSecretWidget.ts",
            contents: "class VendorSecretWidget {}",
          },
        ],
      }),
    );
    const normalizedKeyterms = result.keyterms.map((term) => term.toLowerCase());
    const serialized = JSON.stringify(normalizedKeyterms);

    expect(result.keyterms).toContain("SafeRequestBroker");
    expect(
      ["getting started", "installation", "index", "readme"].some((term) =>
        normalizedKeyterms.includes(term),
      ),
    ).toBe(false);
    expect(serialized).not.toMatch(
      /supersecretcredential|hiddenportal|vendorsecretwidget|thirdpartypaymentkernel/,
    );
    expect(serialized).not.toMatch(/generatedportal|releaseartifact|generatedgraph/);
    expect(serialized).not.toContain("0123456789abcdef");
    expect(serialized).not.toContain("123e4567");
  });

  it("detects common technologies from manifests, extensions, filenames, and content", () => {
    const result = buildIndexedProjectSpeechProfileContent(
      makeInput({
        workspaceEntries: [
          { path: "frontend/vite.config.ts", kind: "file" },
          { path: "frontend/src/App.tsx", kind: "file" },
          { path: "backend/Cargo.toml", kind: "file" },
          { path: "backend/src/main.rs", kind: "file" },
          { path: "services/api.py", kind: "file" },
          { path: "Dockerfile", kind: "file" },
          { path: "infra/main.tf", kind: "file" },
          { path: "schema.graphql", kind: "file" },
          { path: "mobile/pubspec.yaml", kind: "file" },
          { path: "server/go.mod", kind: "file" },
        ],
        textFiles: [
          {
            path: "frontend/package.json",
            contents: JSON.stringify({
              name: "@acme/frontend",
              dependencies: {
                next: "latest",
                react: "latest",
                tailwindcss: "latest",
              },
              devDependencies: { vitest: "latest" },
            }),
          },
          {
            path: "mobile/pubspec.yaml",
            contents: "name: acme_mobile\ndependencies:\n  flutter:\n    sdk: flutter\n",
          },
          {
            path: "README.md",
            contents: "The service persists data in PostgreSQL.",
          },
        ],
      }),
    );

    expect(result.technologies).toEqual(
      expect.arrayContaining([
        "Dart",
        "Docker",
        "Flutter",
        "Go",
        "GraphQL",
        "Next.js",
        "PostgreSQL",
        "Python",
        "React",
        "Rust",
        "Tailwind CSS",
        "Terraform",
        "TypeScript",
        "Vite",
        "Vitest",
      ]),
    );
  });

  it("keeps the basic fallback to project and repository names plus inferred technologies", () => {
    const input = makeInput({
      projectTitle: "Acme Console",
      repositoryIdentity: {
        canonicalKey: "github.com/acme/console",
        locator: {
          source: "git-remote",
          remoteName: "origin",
          remoteUrl: "https://github.com/acme/console.git",
        },
        displayName: "acme/console",
        owner: "acme",
        name: "console",
      },
      workspaceEntries: [{ path: "src/InternalBillingRouter.tsx", kind: "file" }],
      textFiles: [
        {
          path: "package.json",
          contents: JSON.stringify({
            name: "@acme/private-runtime",
            dependencies: { react: "latest", typescript: "latest" },
          }),
        },
        {
          path: "README.md",
          contents: "## Hidden Architecture\nInternalPaymentScheduler",
        },
      ],
    });
    const result = buildBasicProjectSpeechProfileContent(input);

    expect(result.keyterms).toEqual([
      "Acme Console",
      "acme/console",
      "console",
      "React",
      "TypeScript",
    ]);
    expect(result.contextPrompt).not.toContain("InternalBillingRouter");
  });

  it("uses the workspace basename when no safe project or repository name is available", () => {
    const result = buildBasicProjectSpeechProfileContent(
      makeInput({
        projectTitle: "   ",
        workspaceRoot: "C:\\work\\voice-console\\",
        workspaceEntries: [{ path: "src/main.go", kind: "file" }],
      }),
    );

    expect(result.keyterms).toEqual(expect.arrayContaining(["voice-console", "Go"]));
    expect(result.contextPrompt).toContain("voice-console");
  });
});
