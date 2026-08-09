export function shouldCloneTabIntoPane(tabType: string): boolean {
  return tabType === "table" || tabType === "sql" || tabType === "workflow";
}
