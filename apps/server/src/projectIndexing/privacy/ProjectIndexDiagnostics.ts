export const PROJECT_INDEX_THREAD_PREFIX = "project-index:";

export function isProjectIndexAnalysisThread(threadId: string | null): boolean {
  return threadId?.startsWith(PROJECT_INDEX_THREAD_PREFIX) === true;
}
