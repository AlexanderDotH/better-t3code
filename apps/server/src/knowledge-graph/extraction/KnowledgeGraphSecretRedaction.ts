const STRUCTURED_SECRET_ASSIGNMENT =
  /((?:"|')?(?:api[_-]?key|access[_-]?token|auth[_-]?token|aws[_-]?access[_-]?key[_-]?id|aws[_-]?secret[_-]?access[_-]?key|bearer[_-]?token|client[_-]?secret|connection[_-]?string|credential(?:s)?|database[_-]?(?:url|uri)|password|private[_-]?key|secret|token)(?:"|')?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}\]]+)/giu;

const PRIVATE_KEY_BLOCK =
  /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/giu;
const URI_PASSWORD = /([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+(@)/giu;
const AUTHORIZATION_BEARER = /\b(Bearer\s+)[a-z0-9._~+/-]+=*/giu;
const AUTHORIZATION_HEADER = /\b(Authorization\s*[:=]\s*(?:Basic|Bearer)\s+)[a-z0-9._~+/-]+=*/giu;
const WELL_KNOWN_CREDENTIAL =
  /\b(?:AI(?:za|Sy)[a-z0-9_-]{20,}|AKIA[0-9A-Z_-]{12,}|ASIA[0-9A-Z_-]{12,}|github_pat_[a-z0-9_]{8,}|gh[pousr]_[a-z0-9_]{8,}|(?:sk|rk)_(?:live|test)_[a-z0-9]{16,}|sk-(?:proj-)?[a-z0-9_-]{8,}|xox[baprs]-[a-z0-9-]{8,})\b/giu;

export function redactKnowledgeGraphEvidenceExcerpt(content: string): string {
  return content
    .replace(PRIVATE_KEY_BLOCK, "[REDACTED PRIVATE KEY]")
    .replace(STRUCTURED_SECRET_ASSIGNMENT, '$1"[REDACTED]"')
    .replace(URI_PASSWORD, "$1[REDACTED]$2")
    .replace(AUTHORIZATION_HEADER, "$1[REDACTED]")
    .replace(AUTHORIZATION_BEARER, "$1[REDACTED]")
    .replace(WELL_KNOWN_CREDENTIAL, "[REDACTED CREDENTIAL]");
}
