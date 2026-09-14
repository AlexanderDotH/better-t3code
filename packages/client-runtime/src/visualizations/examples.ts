import { isExperimentalVisualization, type VisualizationFormat } from "./model.ts";

export type VisualizationExample = {
  id: string;
  format: VisualizationFormat;
  family: string;
  source: string;
  experimental?: boolean;
};

const example = (
  format: VisualizationFormat,
  family: string,
  source: string,
  experimental = false,
): VisualizationExample => ({ id: `${format}-${family}`, format, family, source, experimental });

const mermaid = (family: string, source: string) =>
  example("mermaid", family, source, isExperimentalVisualization("mermaid", source));
const plantuml = (family: string, source: string, wrapper = "uml") =>
  example("plantuml", family, `@start${wrapper}\n${source}\n@end${wrapper}`);

const sampleRows = [
  { month: "2026-01-01", team: "North", revenue: 24, target: 25, low: 21, high: 27 },
  { month: "2026-02-01", team: "South", revenue: 31, target: 30, low: 28, high: 34 },
  { month: "2026-03-01", team: "North", revenue: 28, target: 30, low: 25, high: 31 },
];

const sampleMetadata = {
  t3: {
    purpose: "analysis",
    summary: "Illustrative revenue in thousands of EUR, January–March 2026.",
    sources: ["Embedded fictional training dataset"],
    asOf: "2026-03-31",
    kind: "example",
    limitations: ["Fictional values; not actual business results."],
  },
};

const lite = (family: string, spec: Record<string, unknown>) =>
  example(
    "vega-lite",
    family,
    JSON.stringify({
      title: "Example revenue compared with target (EUR thousands)",
      width: 320,
      height: 180,
      data: { values: sampleRows },
      usermeta: sampleMetadata,
      ...spec,
    }),
  );

const vega = (family: string, spec: Record<string, unknown>) =>
  example(
    "vega",
    family,
    JSON.stringify({
      width: 320,
      height: 180,
      usermeta: sampleMetadata,
      ...spec,
    }),
  );

const timeEncoding = {
  x: { field: "month", type: "temporal", title: "Month (2026)" },
  y: { field: "revenue", type: "quantitative", title: "Revenue (EUR thousands)" },
};

const hierarchy = [
  { id: "All", parent: null },
  { id: "Learning", parent: "All", value: 4 },
  { id: "Analysis", parent: "All", value: 6 },
];

export const VISUALIZATION_EXAMPLES: readonly VisualizationExample[] = [
  mermaid(
    "flowchart",
    "flowchart LR\n  Read[Read the input] -->|check| Valid{Valid?}\n  Valid -->|yes| Save[Save result]\n  Valid -->|no| Explain[Explain the error]",
  ),
  mermaid(
    "swimlanes",
    "swimlane-beta LR\n  subgraph Customer\n    Request[Submit request]\n  end\n  subgraph Support\n    Reply[Explain solution]\n  end\n  Request -->|ticket| Reply",
  ),
  mermaid(
    "sequence",
    "sequenceDiagram\n  participant Learner\n  participant Tutor\n  Learner->>Tutor: Predict the result\n  Tutor-->>Learner: Explain after the answer",
  ),
  mermaid(
    "class",
    "classDiagram\n  class Course {\n    +String title\n    +start()\n  }\n  Course --> Lesson : contains",
  ),
  mermaid(
    "state",
    "stateDiagram-v2\n  [*] --> Draft\n  Draft --> Reviewed: check\n  Reviewed --> [*]: accept",
  ),
  mermaid(
    "entity-relationship",
    "erDiagram\n  COURSE ||--o{ LESSON : contains\n  COURSE {\n    string title\n  }",
  ),
  mermaid(
    "architecture",
    "architecture-beta\n  service app(server)[Application]\n  service db(database)[Storage]\n  app:R --> L:db",
  ),
  mermaid(
    "c4",
    'C4Context\n  Person(learner, "Learner", "Studies a concept")\n  System(tutor, "Tutor", "Explains the concept")\n  Rel(learner, tutor, "Asks a question")',
  ),
  mermaid(
    "requirements",
    "requirementDiagram\n  requirement explain {\n    id: 1\n    text: explain clearly\n    risk: low\n    verifymethod: test\n  }\n  element lesson {\n    type: lesson\n  }\n  lesson - satisfies -> explain",
  ),
  mermaid(
    "use-case",
    'usecase-beta\n  actor Learner\n  Explain("Understand a concept")\n  Learner --> Explain',
  ),
  mermaid("mindmap", "mindmap\n  root((Understanding))\n    Example\n    Prediction\n    Feedback"),
  mermaid(
    "timeline",
    "timeline\n  title Learning sequence\n  First : Example\n  Next : Prediction\n  Last : Feedback",
  ),
  mermaid(
    "gantt",
    "gantt\n  title Learning plan\n  dateFormat YYYY-MM-DD\n  section Practice\n  Read :2026-09-01, 1d\n  Apply :2026-09-02, 2d",
  ),
  mermaid(
    "git",
    "gitGraph\n  commit\n  branch explanation\n  checkout explanation\n  commit\n  checkout main\n  merge explanation",
  ),
  mermaid(
    "journey",
    "journey\n  title Understand a concept\n  section Practice\n    Read example: 4: Learner\n    Apply concept: 5: Learner",
  ),
  mermaid(
    "kanban",
    "kanban\n  todo[To learn]\n    concept[Read an example]\n  done[Understood]\n    basics[Explain the basics]",
  ),
  mermaid("sankey", "sankey-beta\nInput,Learning,6\nInput,Analysis,4"),
  mermaid(
    "quadrant",
    "quadrantChart\n  title Example priorities\n  x-axis Low effort --> High effort\n  y-axis Low benefit --> High benefit\n  Lesson: [0.2, 0.8]",
  ),
  mermaid("packet", 'packet-beta\n  0-7: "Version"\n  8-15: "Length"'),
  mermaid("block", 'block-beta\n  columns 2\n  read["Read"] apply["Apply"]\n  read --> apply'),
  mermaid("pie", 'pie title Example time allocation\n  "Practice" : 60\n  "Reading" : 40'),
  mermaid(
    "xy",
    'xychart-beta\n  title "Example progress"\n  x-axis [First, Second, Third]\n  y-axis "Points" 0 --> 10\n  line [2, 5, 8]',
  ),
  plantuml(
    "activity",
    "start\n:Read example;\nif (Understood?) then (yes)\n  :Apply;\nelse (no)\n  :Ask again;\nendif\nstop",
  ),
  plantuml(
    "object",
    'object "Lesson one" as lesson\nobject "Course" as course\ncourse --> lesson : contains',
  ),
  plantuml("component", "[Client] --> [Server] : request"),
  plantuml(
    "deployment",
    'node "Device" {\n  [Client]\n}\nnode "Environment" {\n  [Server]\n}\n[Client] --> [Server] : connects',
  ),
  plantuml("timing", 'robust "Connection" as C\n@0\nC is Idle\n@5\nC is Active'),
  plantuml("class", 'class Course\nclass Lesson\nCourse "1" --> "many" Lesson : contains'),
  plantuml("sequence", "Learner -> Tutor : Ask\nTutor --> Learner : Explain"),
  plantuml("state", "[*] --> Draft\nDraft --> Complete : review\nComplete --> [*]"),
  plantuml("use-case", "actor Learner\nLearner --> (Understand a concept)"),
  plantuml(
    "archimate",
    'archimate #Application "Learning application" as app\narchimate #Business "Learning process" as process\napp --> process : supports',
  ),
  plantuml(
    "work-breakdown",
    "* Learn a concept\n** Read example\n** Predict outcome\n** Apply independently",
    "wbs",
  ),
  plantuml("mindmap", "* Understand\n** Example\n** Practice", "mindmap"),
  plantuml("json", '{"lesson":"Examples","complete":false}', "json"),
  example(
    "dot",
    "directed",
    'digraph { Client -> Server [label="request"]; Server -> Storage [label="query"]; }',
  ),
  example("dot", "undirected", 'graph { Alice -- Bob [label="collaborates"]; Bob -- Carol; }'),
  example("dot", "tree", "digraph { Course -> LessonA; Course -> LessonB; LessonA -> Exercise; }"),
  example(
    "dot",
    "network",
    "graph { Router -- Laptop; Router -- Phone; Router -- Server; Server -- Laptop; }",
  ),
  lite("bar", {
    mark: "bar",
    encoding: {
      x: { field: "team", type: "nominal" },
      y: { aggregate: "sum", field: "revenue", type: "quantitative" },
    },
  }),
  lite("line", { mark: "line", encoding: timeEncoding }),
  lite("area", { mark: "area", encoding: timeEncoding }),
  lite("scatter", {
    mark: "point",
    encoding: {
      x: { field: "target", type: "quantitative" },
      y: { field: "revenue", type: "quantitative" },
    },
  }),
  lite("histogram", {
    mark: "bar",
    encoding: {
      x: { field: "revenue", type: "quantitative", bin: true },
      y: { aggregate: "count", type: "quantitative" },
    },
  }),
  lite("boxplot", {
    mark: "boxplot",
    encoding: {
      x: { field: "team", type: "nominal" },
      y: { field: "revenue", type: "quantitative" },
    },
  }),
  lite("heatmap", {
    mark: "rect",
    encoding: {
      x: { field: "month", type: "ordinal" },
      y: { field: "team", type: "nominal" },
      color: { field: "revenue", type: "quantitative" },
    },
  }),
  lite("errorbar", {
    mark: "errorbar",
    encoding: {
      x: { field: "month", type: "temporal" },
      y: { field: "low", type: "quantitative" },
      y2: { field: "high" },
    },
  }),
  lite("target", {
    layer: [
      { mark: "bar", encoding: timeEncoding },
      {
        mark: { type: "tick", color: "red" },
        encoding: { ...timeEncoding, y: { field: "target", type: "quantitative" } },
      },
    ],
  }),
  lite("combined", {
    vconcat: [
      { mark: "line", encoding: timeEncoding },
      { mark: "bar", encoding: timeEncoding },
    ],
  }),
  lite("selection", {
    params: [{ name: "region", select: { type: "point", fields: ["team"] }, bind: "legend" }],
    mark: "point",
    encoding: {
      ...timeEncoding,
      color: { field: "team", type: "nominal" },
      opacity: { condition: { param: "region", value: 1 }, value: 0.2 },
    },
  }),
  vega("treemap", {
    data: [
      {
        name: "tree",
        values: hierarchy,
        transform: [
          { type: "stratify", key: "id", parentKey: "parent" },
          { type: "treemap", field: "value", size: [320, 180] },
        ],
      },
    ],
    marks: [
      {
        type: "rect",
        from: { data: "tree" },
        encode: {
          enter: {
            x: { field: "x0" },
            y: { field: "y0" },
            x2: { field: "x1" },
            y2: { field: "y1" },
            fill: { value: "steelblue" },
            stroke: { value: "white" },
          },
        },
      },
    ],
  }),
  vega("sunburst", {
    data: [
      {
        name: "tree",
        values: hierarchy,
        transform: [
          { type: "stratify", key: "id", parentKey: "parent" },
          { type: "partition", field: "value", size: [6.283185307179586, 80] },
        ],
      },
    ],
    marks: [
      {
        type: "arc",
        from: { data: "tree" },
        encode: {
          enter: {
            x: { value: 160 },
            y: { value: 90 },
            startAngle: { field: "x0" },
            endAngle: { field: "x1" },
            innerRadius: { field: "y0" },
            outerRadius: { field: "y1" },
            fill: { value: "steelblue" },
            stroke: { value: "white" },
          },
        },
      },
    ],
  }),
  vega("dataflow", {
    data: [
      {
        name: "flows",
        values: [{ source: { x: 10, y: 50 }, target: { x: 300, y: 90 }, value: 12 }],
        transform: [{ type: "linkpath", orient: "horizontal", shape: "diagonal" }],
      },
    ],
    marks: [
      {
        type: "path",
        from: { data: "flows" },
        encode: {
          enter: {
            path: { field: "path" },
            stroke: { value: "steelblue" },
            strokeWidth: { field: "value" },
          },
        },
      },
    ],
  }),
  vega("network", {
    data: [
      {
        name: "nodes",
        values: [{ id: 0 }, { id: 1 }, { id: 2 }],
        transform: [
          {
            type: "force",
            static: true,
            iterations: 20,
            forces: [
              { force: "center", x: 160, y: 90 },
              { force: "collide", radius: 20 },
              { force: "nbody" },
            ],
          },
        ],
      },
    ],
    marks: [
      {
        type: "symbol",
        from: { data: "nodes" },
        encode: {
          enter: {
            x: { field: "x" },
            y: { field: "y" },
            size: { value: 200 },
            fill: { value: "steelblue" },
          },
        },
      },
    ],
  }),
  vega("map", {
    projections: [{ name: "projection", type: "mercator", scale: 100, translate: [160, 90] }],
    data: [
      {
        name: "areas",
        values: [
          {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [-5, -5],
                  [5, -5],
                  [5, 5],
                  [-5, 5],
                  [-5, -5],
                ],
              ],
            },
          },
        ],
      },
    ],
    marks: [
      {
        type: "shape",
        from: { data: "areas" },
        transform: [{ type: "geoshape", projection: "projection" }],
        encode: { enter: { fill: { value: "steelblue" } } },
      },
    ],
  }),
  vega("custom-analysis", {
    data: [
      {
        name: "values",
        values: sampleRows,
        transform: [{ type: "formula", as: "gap", expr: "datum.revenue - datum.target" }],
      },
    ],
    marks: [
      {
        type: "text",
        from: { data: "values" },
        encode: {
          enter: {
            x: { value: 20 },
            y: { signal: "20 + datum.gap * 10" },
            text: { signal: "datum.team + ': ' + datum.gap" },
            fill: { value: "steelblue" },
          },
        },
      },
    ],
  }),
];
