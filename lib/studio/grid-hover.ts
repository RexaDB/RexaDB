function escapeCssAttributeValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\a ")
    .replace(/\r/g, "\\d ")
    .replace(/\f/g, "\\c ");
}

export function buildHoveredColumnCss(
  gridInstanceId: string,
  columnName: string
): string {
  const scopedGridSelector = `[data-grid-instance="${escapeCssAttributeValue(gridInstanceId)}"]`;
  const columnSelector = `[data-column-name="${escapeCssAttributeValue(columnName)}"]`;

  return `
    ${scopedGridSelector} ${columnSelector}:not([data-selected="true"]) {
      background-color: var(--studio-row-hover) !important;
    }
  `;
}
