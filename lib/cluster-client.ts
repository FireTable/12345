/** 浏览器进程内只允许一条研判 POST，避免 Strict Mode / 连点打出多次 /api/cluster。 */

let activeTaskId: string | null = null;

export function claimClusterTask(nextId: string): { claimed: boolean; taskId: string } {
  if (activeTaskId) return { claimed: false, taskId: activeTaskId };
  activeTaskId = nextId;
  return { claimed: true, taskId: nextId };
}

export function releaseClusterTask(taskId?: string) {
  if (!taskId || activeTaskId === taskId) activeTaskId = null;
}

export function currentClusterTaskId() {
  return activeTaskId;
}
