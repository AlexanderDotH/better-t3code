import type {
  AgentSkillContext,
  AgentSkillDefinition,
  PageVerticalPaddingContract,
  PageVerticalPaddingSource,
} from "./SkillPromptTypes.ts";

export const SECTION_ENTRY_PRINT_LAYOUT_SKILL_ID = "section-entry-print-layout";

const DEFAULT_ENTRIES_PADDING_TOP_MM = 3;
const DEFAULT_ENTRY_GAP_MM = 2.5;
const DEFAULT_TITLE_BOTTOM_GAP_MM = 2;
const DEFAULT_PRE_BREAK_CUSHION_MM = 2;

const CUSTOMER_FORM_PAGE_PADDING_LABELS = [
  "Page vertical padding",
  "Page vertical inset",
  "Spacing after page break",
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeMarkdownLine(value: string): string {
  return value
    .replace(/\*/g, "")
    .replace(/^\s*[-*]\s*/, "")
    .trim();
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function parseCustomerFormLine(markdown: string | null | undefined, label: string): string | null {
  if (!markdown?.trim()) return null;

  const pattern = new RegExp(`^${escapeRegExp(label)}\\s*:\\s*(.+)`, "i");
  for (const rawLine of markdown.split(/\r?\n/)) {
    const match = normalizeMarkdownLine(rawLine).match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }

  return null;
}

function parseLabeledMmValue(markdown: string | null | undefined, label: string): number | null {
  const value = parseCustomerFormLine(markdown, label);
  if (!value) return null;

  const match = value.match(/^([\d.]+)\s*mm\b/i);
  if (!match?.[1]) return null;

  const parsed = Number.parseFloat(match[1]);
  return isPositiveFinite(parsed) ? parsed : null;
}

function contractFromMm(
  mm: number,
  source: PageVerticalPaddingSource,
): PageVerticalPaddingContract {
  return {
    topMm: mm,
    bottomMm: mm,
    applyTo: "all_pages",
    source,
  };
}

function normalizeProvidedPadding(
  contract: PageVerticalPaddingContract | null | undefined,
): PageVerticalPaddingContract | null {
  if (!contract) return null;
  if (!isPositiveFinite(contract.topMm) || !isPositiveFinite(contract.bottomMm)) return null;

  return {
    topMm: contract.topMm,
    bottomMm: contract.bottomMm,
    applyTo: "all_pages",
    source: contract.source ?? "explicit",
  };
}

export function resolveSectionEntryPageVerticalPadding(
  ctx: AgentSkillContext,
): PageVerticalPaddingContract | null {
  for (const label of CUSTOMER_FORM_PAGE_PADDING_LABELS) {
    const mm = parseLabeledMmValue(ctx.customerFormPromptMarkdown, label);
    if (mm !== null) return contractFromMm(mm, "customer-form");
  }

  return normalizeProvidedPadding(ctx.pageVerticalPadding);
}

export function buildPageVerticalPaddingPromptBlock(contract: PageVerticalPaddingContract): string {
  const topMm = contract.topMm;
  const bottomMm = contract.bottomMm;
  const expectedLine =
    topMm === bottomMm
      ? `- When calling layout checks, pass \`expectedPageVerticalInsetMm: ${topMm}\` so verification enforces this contract.\n`
      : "";

  return `### Page vertical padding contract (HIGHEST PRIORITY)
- **Page vertical padding:** ${topMm}mm top and ${bottomMm}mm bottom on every print page (page 1 and continuation pages).
- Keep \`@page { size: A4; margin: 0; }\` as the full-bleed print boundary; do **not** satisfy this only with \`@page { margin-top: ${topMm}mm; }\`.
- Implement the inset in template CSS with \`--asterix-page-y-padding: ${topMm}mm\`, \`.page { padding-top: var(--asterix-page-y-padding); padding-bottom: var(--asterix-page-y-padding); box-sizing: border-box; }\`, and \`box-decoration-break: clone\`.
${expectedLine}- In print CSS, never reset configured page padding to zero. \`.page { padding-top: 0; }\` or \`.page { padding-bottom: 0; }\` is a blocking defect when this contract is active.
- This page-level padding is separate from list spacing such as \`.section-entries { padding-top: 3mm; }\`; apply both when both are relevant.`;
}

function buildGeometrySchema(ctx: AgentSkillContext): string {
  const pageVerticalPadding = resolveSectionEntryPageVerticalPadding(ctx);
  const schema = {
    sectionEntryLayout: {
      entriesPaddingTopMm: DEFAULT_ENTRIES_PADDING_TOP_MM,
      entryGapMm: DEFAULT_ENTRY_GAP_MM,
      titleBottomGapMm: DEFAULT_TITLE_BOTTOM_GAP_MM,
      preBreakCushionMm: DEFAULT_PRE_BREAK_CUSHION_MM,
    },
    pageVerticalPadding: {
      topMm: pageVerticalPadding?.topMm ?? 0,
      bottomMm: pageVerticalPadding?.bottomMm ?? 0,
      applyTo: "all_pages",
    },
  };

  return JSON.stringify(schema, null, 2);
}

function resolvePageBreakMode(ctx: AgentSkillContext): string | null {
  if (ctx.pageBreakMode?.trim()) return ctx.pageBreakMode.trim();
  return parseCustomerFormLine(ctx.customerFormPromptMarkdown, "Page break / wrapping");
}

export function buildSectionEntryPrintLayoutAppendix(ctx: AgentSkillContext): string {
  const pageVerticalPadding = resolveSectionEntryPageVerticalPadding(ctx);
  const geometryJson = buildGeometrySchema(ctx);
  const pageBreakMode = resolvePageBreakMode(ctx);
  const configSource =
    pageVerticalPadding?.source === "wizard" ? "wizard or customer form" : "customer form";

  const pageVerticalPaddingText = pageVerticalPadding
    ? `Configured page vertical padding: ${pageVerticalPadding.topMm}mm top and ${pageVerticalPadding.bottomMm}mm bottom on every print page. Follow the injected **Page vertical padding contract**; do not implement this with \`@page margin-top\` only, and do not reset \`.page\` top/bottom padding to zero in print CSS.`
    : `When the ${configSource} specifies numeric page vertical padding, apply it as top and bottom \`.page\` padding on every print page. Default page vertical padding is 0 unless configured.`;

  const pageBreakModeLine = pageBreakMode
    ? `\n- **Customer page-break mode:** ${pageBreakMode} - honor when choosing where sections may start on a new page.`
    : "";

  return `
### Skill: Section Entry Print Layout (MANDATORY when enabled)
List-style CV blocks (SPRACHKENNTNISSE, ZERTIFIKATE, F\u00c4HIGKEITEN, ST\u00c4RKEN, ...) are **stacked table-like entries**, not loose paragraphs. Apply **both** per-section entry spacing **and** page vertical padding - they are distinct concerns.

Full reference (when MCP is available): \`repo_knowledge_read\` with \`fileKey: "section-entry-table-layout"\`.

#### 1. HTML structure
Wrap every list-style block:

\`\`\`html
<section class="cv-section cv-section--languages">
  <h2 class="section-title">SPRACHKENNTNISSE</h2>
  <div class="section-entries">
    {{#each cv.LanguageExperience}}
    <article class="section-entry">
      <div class="entry-row entry-row--split">
        <span class="entry-label">{{#if title}}{{title}}{{else}}{{Language.description}}{{/if}}</span>
        <span class="entry-value">{{Level.description}}</span>
      </div>
      <div class="entry-row entry-row--bar">
        <div class="lang-bar" role="presentation">
          <div class="lang-bar-fill" style="width: {{languageLevelWidth Level_code}};"></div>
        </div>
      </div>
    </article>
    {{/each}}
  </div>
</section>
\`\`\`

Certificates / qualifications (\`cv.Qualification\` or equivalent):

\`\`\`html
<section class="cv-section cv-section--certificates">
  <h2 class="section-title">ZERTIFIKATE</h2>
  <div class="section-entries">
    {{#each cv.Qualification}}
    <article class="section-entry">
      <p class="entry-title">{{title}}</p>
      <p class="entry-subtitle">{{organization}}</p>
      <p class="entry-meta">{{#if endDate}}{{startDate}} - {{endDate}}{{else}}{{startDate}}{{/if}}</p>
    </article>
    {{/each}}
  </div>
</section>
\`\`\`

Use the same \`.section-entries\` / \`.section-entry\` pattern for skills, strengths, interests, and similar blocks unless the reference is clearly a single prose block (for example PROFIL).

#### 2. CSS - per-section entry spacing (mm)
**Do not** rely on margin collapse. Set spacing explicitly in **mm**:

\`\`\`css
.cv-section .section-title {
  margin: 0 0 ${DEFAULT_TITLE_BOTTOM_GAP_MM}mm 0;
  break-after: avoid;
  page-break-after: avoid;
}

.cv-section .section-entries {
  padding-top: ${DEFAULT_ENTRIES_PADDING_TOP_MM}mm;
  padding-bottom: ${DEFAULT_PRE_BREAK_CUSHION_MM}mm;
}

.cv-section .section-entry {
  margin: 0 0 ${DEFAULT_ENTRY_GAP_MM}mm 0;
  break-inside: avoid;
  page-break-inside: avoid;
}

.cv-section .section-entry:last-child {
  margin-bottom: 0;
}

.entry-row--split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  column-gap: 4mm;
}

.entry-label,
.entry-value {
  min-width: 0;
  overflow-wrap: anywhere;
}

.entry-row--bar {
  margin-top: 1mm;
}

.lang-bar {
  width: 100%;
  height: 2.5mm;
  border-radius: 999px;
  overflow: hidden;
}

.lang-bar-fill {
  height: 100%;
  border-radius: inherit;
}
\`\`\`

Tune mm values to match the reference. When the preparation/layout plan lists \`sectionGapMm\`, use that value for **\`padding-top\` on \`.section-entries\`**.

#### 3. Page vertical padding and break spacing (two mechanisms - apply both when configured)

**A. Page vertical padding** - configured whitespace at the top and bottom of every printed page:
${pageVerticalPaddingText}${pageBreakModeLine}

**B. Before page break** - avoid bad late breaks and glued headings:
- \`.section-title\`: \`break-after: avoid; page-break-after: avoid;\` (see CSS above)
- \`.section-entry\`: \`break-inside: avoid; page-break-inside: avoid;\` (never on the whole \`.cv-section\`)
- \`.section-entries\`: \`padding-bottom: ${DEFAULT_PRE_BREAK_CUSHION_MM}mm\` as a cushion so content breaks earlier when space is tight

Per-section **first-entry inset** (\`.section-entries\` \`padding-top\`) is **different** from page-level vertical padding - apply **both** when configured.

#### 4. Preparation / layout geometry schema
Include or merge this block in layout-phase JSON (tune mm from reference):

\`\`\`json
${geometryJson}
\`\`\`

#### 5. Anti-patterns (blocking defects)
- Section title immediately followed by the first \`{{#each}}\` child **without** \`.section-entries\` wrapper and **without** \`padding-top\`.
- Using only \`margin-top\` on \`:first-child\` while parent padding is zero - prefer **\`padding-top\` on \`.section-entries\`**.
- Label and value in a single \`<p>\` with \`<br>\` when the reference shows left/right columns.
- Putting progress bars in the raster background - bars are **HTML/CSS** with \`{{languageLevelWidth}}\` / \`{{calculateWidth}}\`.
- \`break-inside: avoid\` on the entire \`.cv-section\`.

#### 6. Verification checklist
1. First entry under SPRACHKENNTNISSE, ZERTIFIKATE, F\u00c4HIGKEITEN, etc. has visible **top inset** (not glued to the heading).
2. Each entry has **bottom spacing** before the next entry.
3. Label/value rows read as a **table row** (baseline-aligned columns).
4. Language blocks include a **bar row** when the reference shows a bar.
5. Page vertical padding matches ${configSource} when configured.

If missing, file a **blocking** issue with a concrete fix (for example "Add \`padding-top: 3mm\` on \`.section-entries\` under SPRACHKENNTNISSE").`;
}

export const sectionEntryPrintLayoutSkill: AgentSkillDefinition = {
  id: SECTION_ENTRY_PRINT_LAYOUT_SKILL_ID,
  i18nKey: "skills.sectionEntryPrintLayout",
  phases: ["preparation", "layout", "implementation", "rework", "verification"],
  surfaces: ["workflowPhase", "freeChatTools", "freeChatStream"],
  buildAppendix: buildSectionEntryPrintLayoutAppendix,
};
