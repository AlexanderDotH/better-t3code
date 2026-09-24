import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe, expect } from "vite-plus/test";

import {
  projectArtifactPathReason,
  type ProjectArtifactReason,
} from "./ProjectArtifactPathPolicy.ts";
import { hashProjectSourceFile, isSafeProjectSourcePath } from "./WorkspacePrivacy.ts";

const artifacts: ReadonlyArray<readonly [string, ProjectArtifactReason]> = [
  ["chat-archive.json", "chat archive"],
  ["conversations.json", "chat archive"],
  ["chatgpt-export.json", "chat archive"],
  ["claude-conversations.json", "chat archive"],
  [".codex/history.jsonl", "chat archive"],
  [".claude/session.json", "chat archive"],
  ["ChatArchive.JSON.GZ", "chat archive"],
  ["saved_conversations.json", "chat archive"],
  ["exports/conversation-history-2026-09-21.jsonl", "chat archive"],
  ["exports/chat-transcript.html", "chat archive"],
  ["archives/chat-backup.zip", "chat archive"],
  ["conversations.gz", "chat archive"],
  ["sessions/123.json", "chat archive"],
  ["conversations/2026-09-21.md", "chat archive"],
  ["logs/session.json", "log artifact"],
  ["logs/session.txt", "log artifact"],
  ["logs/session.md", "log artifact"],
  ["Logs\\session.JSON", "log artifact"],
  ["runtime/logs/2026-09-21.ndjson", "log artifact"],
  ["server.log.1.gz", "log artifact"],
  ["access-log.json", "log artifact"],
  ["data/application.sqlite", "database artifact"],
  ["data/application.sqlite-wal", "database artifact"],
  ["data/application.db-shm", "database artifact"],
  ["database-dump.json", "database artifact"],
  ["dbdump.json", "database artifact"],
  ["dump.sql", "database artifact"],
  ["backups/production.sql", "database artifact"],
  ["production.sql.gz", "database artifact"],
  ["runtime/session.json", "runtime dump"],
  ["runtime/cache/current.json", "runtime dump"],
  [".cache/current.json", "runtime dump"],
  ["user-data/settings.json", "runtime dump"],
  ["runtime-dump.json", "runtime dump"],
  ["runtime-state.yaml", "runtime dump"],
  ["heap.heapsnapshot", "runtime dump"],
  ["capture.cpuprofile", "runtime dump"],
  ["crash.dmp", "runtime dump"],
];

const projectSources = [
  "src/runtime/Session.ts",
  "src/runtime/session.js",
  "src/chat/Conversation.java",
  "src/chat/Conversation.html",
  "src/chat/chat-archive.ts",
  "src/logs/Session.cs",
  "src/dumps/DatabaseDump.java",
  "src/state/Session.swift",
  "src/sessions/Controller.py",
  "src/user-data/Serializer.ts",
  "runtime/package.json",
  "src/runtime/session-policy.json",
  ".codex/config.toml",
  ".claude/settings.json",
  "src/runtime/session.config.json",
  "config/runtime.json",
  "config/logging.json",
  "config/database.json",
  "runtime/runtimeconfig.json",
  "runtime/Application.runtimeconfig.json",
  "src/runtime/appsettings.Development.json",
  "logs/log4j2.json",
  "logs/logback.xml",
  "conversations.schema.json",
  "schemas/conversations.json",
  "locales/en/conversations.json",
  "i18n/en/messages.json",
  "tsconfig.build.json",
  "package.json",
  "database/schema.sql",
  "database/migrations/001_create_sessions.sql",
  "src/runtime/select-session.sql",
  "docs/conversations.md",
  "docs/conversations/overview.md",
];

describe("project artifact privacy", () => {
  it.each(artifacts)("excludes %s as %s", (path, reason) => {
    expect(projectArtifactPathReason(path)).toBe(reason);
    expect(isSafeProjectSourcePath(path)).toBe(false);
  });

  it.each(projectSources)("preserves implementation or configuration at %s", (path) => {
    expect(projectArtifactPathReason(path)).toBeNull();
    expect(isSafeProjectSourcePath(path)).toBe(true);
  });

  it.effect("rejects recognized artifacts before attempting any workspace or file read", () =>
    Effect.gen(function* () {
      for (const [path] of artifacts) {
        const error = yield* Effect.flip(
          hashProjectSourceFile("/synthetic/nonexistent/project-index-workspace", path),
        );
        expect(error.code).toBe("private-source");
      }
    }),
  );
});
