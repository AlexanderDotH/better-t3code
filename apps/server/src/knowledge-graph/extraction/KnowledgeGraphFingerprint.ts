// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import {
  KnowledgeGraphEdgeId,
  KnowledgeGraphEvidenceId,
  KnowledgeGraphNodeId,
  type KnowledgeGraphScopeId,
} from "@t3tools/contracts";

export const KNOWLEDGE_GRAPH_EXTRACTION_VERSION = 1;

export function fingerprintKnowledgeGraphContent(content: string): string {
  return NodeCrypto.createHash("sha256").update(content).digest("hex");
}

function scopedIdentifier(scopeId: KnowledgeGraphScopeId, kind: string, key: string): string {
  const digest = fingerprintKnowledgeGraphContent(`${scopeId}\0${kind}\0${key}`).slice(0, 40);
  return `kg:${kind}:${digest}`;
}

export function makeKnowledgeGraphNodeId(
  scopeId: KnowledgeGraphScopeId,
  kind: string,
  key: string,
): KnowledgeGraphNodeId {
  return KnowledgeGraphNodeId.make(scopedIdentifier(scopeId, `node-${kind}`, key));
}

export function makeKnowledgeGraphEdgeId(
  scopeId: KnowledgeGraphScopeId,
  kind: string,
  key: string,
): KnowledgeGraphEdgeId {
  return KnowledgeGraphEdgeId.make(scopedIdentifier(scopeId, `edge-${kind}`, key));
}

export function makeKnowledgeGraphEvidenceId(
  scopeId: KnowledgeGraphScopeId,
  kind: string,
  key: string,
): KnowledgeGraphEvidenceId {
  return KnowledgeGraphEvidenceId.make(scopedIdentifier(scopeId, `evidence-${kind}`, key));
}
