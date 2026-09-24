const isBun = process.versions.bun !== undefined;
const Database = isBun ? require("bun:sqlite").Database : require("node:sqlite").DatabaseSync;
const database = new Database(":memory:");

try {
  database.exec("CREATE VIRTUAL TABLE project_index_fts USING fts5(name)");
  const prepare = (query) => (isBun ? database.query(query) : database.prepare(query));
  prepare("INSERT INTO project_index_fts(name) VALUES (?)").run("ExampleSymbol");
  const match = prepare(
    "SELECT count(*) AS count FROM project_index_fts WHERE project_index_fts MATCH ?",
  ).get("ExampleSymbol");
  if (match?.count !== 1) throw new Error("SQLite FTS5 is unavailable or returned no result");
} finally {
  database.close();
}
