export type RowSelectionState = {
  ids: ReadonlySet<number>;
  anchorId: number | null;
};

export type SelectionModifiers = {
  toggle: boolean;
  range: boolean;
};

export function selectRow(
  selection: RowSelectionState,
  id: number,
  visibleIds: readonly number[],
  modifiers: SelectionModifiers,
): RowSelectionState {
  const anchorIndex = selection.anchorId === null ? -1 : visibleIds.indexOf(selection.anchorId);
  const index = visibleIds.indexOf(id);
  if (index < 0) return selection;

  if (modifiers.range && anchorIndex >= 0) {
    const range = visibleIds.slice(Math.min(anchorIndex, index), Math.max(anchorIndex, index) + 1);
    return {
      ids: modifiers.toggle ? new Set([...selection.ids, ...range]) : new Set(range),
      anchorId: selection.anchorId,
    };
  }

  if (modifiers.toggle) {
    const ids = new Set(selection.ids);
    if (!ids.delete(id)) ids.add(id);
    return { ids, anchorId: id };
  }

  return { ids: new Set([id]), anchorId: id };
}

export function selectRowForContextMenu(
  selection: RowSelectionState,
  id: number,
): RowSelectionState {
  if (selection.ids.has(id)) return selection;
  return { ids: new Set([id]), anchorId: id };
}

export function retainVisibleRows(
  selection: RowSelectionState,
  visibleIds: readonly number[],
): RowSelectionState {
  const visible = new Set(visibleIds);
  const ids = new Set([...selection.ids].filter((id) => visible.has(id)));
  const anchorId =
    selection.anchorId !== null && visible.has(selection.anchorId) ? selection.anchorId : null;

  if (ids.size === selection.ids.size && anchorId === selection.anchorId) return selection;
  return { ids, anchorId };
}
