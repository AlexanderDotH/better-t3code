# Project indexing

Project indexing makes a project's files, symbols, imports, and confirmed call relationships searchable. It runs on the T3 server that owns the project and needs no provider or model. The index helps an agent find relevant source; read the original files before making a change or relying on a conclusion.

## Start an index

Enable **Project Indexing** in **Settings → Better T3 → Project Indexing** for the connected environment. Then select the project and checkout in **Settings → Projects**, enable its index, and choose **Index project**. Each worktree has its own index. Update an older server before starting the model-free index from a new client.

The project or thread shows indexing progress and coverage. Open its index view to inspect packages, source files, dependencies, symbols, calls, and gaps. Once an index revision is published, new chat turns can receive up to 2,000 tokens of relevant source facts automatically. Agents with T3 workspace tools can also query the index through `project_context`. If no revision has been published yet, the agent has no indexed facts to use and must inspect project files directly. A visible index does not guarantee that a particular agent turn used its context.

Indexing uses local parsers and available compiler information. It does not send source to a model, run the project's build or tests, or download dependencies. To review source changes with a model, open **Settings → Projects → AI diff review**, enable code review, and choose its model. Reviews run only when requested and may incur provider usage.

## Keep it current

With automatic updates enabled, the server compares source hashes and reindexes changed files and their affected dependents, including changes found after reconnecting or switching branches. Unchanged files keep their indexed results. Changes to project configuration or rules can require a broader refresh. **Pause** stops updates while preserving the published index; **Resume** reconciles changes. **Rebuild** reconstructs derived data, and **Cancel** stops the current job without deleting the last published revision. **Clear** removes generated index data and disables indexing for that checkout. None of these actions changes project source files.

If you used an earlier preview of Project Indexing, enable it again for each project. T3 rebuilds the local index from source; previous index contents and project indexing settings are not imported.

Turning off the environment's Project Indexing switch pauses work across its projects while retaining their settings and published data. Home directories and filesystem roots cannot be indexed; select a narrower project folder.

## Interpret results

Named declarations are indexed in JavaScript, TypeScript/TSX, C#, Java, Python, Go, Rust, Kotlin, C, C++, Objective-C, Ruby, PHP, Scala, Bash, Dart, Elixir, OCaml, ReScript, Solidity, Zig, and Emacs Lisp. Other text sources remain searchable as files; Swift and Lua currently have file-level coverage. After upgrading language support, choose **Rebuild** once to extract declarations from existing files.

JavaScript, TypeScript, C#, and Java can also use compiler information to confirm call targets when the required project configuration, dependencies, and runtimes are available. Other languages provide syntax facts and supported import references, with explicit local file links where these can be established. Calls without compiler confirmation remain unresolved. A static relationship does not prove a runtime execution path. Dynamic references, missing dependencies, unsupported syntax, and excluded files appear as gaps.

Extracting all files is followed by **Resolving relationships**. Search becomes available when the finished revision is published; a partial index remains usable with its reported gaps.

Original `AGENTS.md` instructions and applicable configuration files are returned with their paths. Nearby code can illustrate an observed pattern, but it is not a repository rule. If the context says a rule was too large to include, open the named file before acting.

C# compiler analysis needs the .NET 10 runtime on the server; Java compiler analysis needs Java 21 or later. Syntax indexing remains available without either runtime. The index is generated under the project's private `.t3` directory and should not be committed or included in support exports. Source-hash checks exclude stale evidence from ordinary queries until it is refreshed.
