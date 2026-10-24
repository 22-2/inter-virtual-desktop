import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionButton,
  Button,
  Checkbox,
  Dialog,
  DialogTrigger,
  Heading,
  Menu,
  MenuItem,
  Picker,
  PickerItem,
  Popover,
  Provider,
  SearchField,
  SubmenuTrigger,
  Text,
  TextField,
  ToastContainer,
  ToastQueue,
} from "@react-spectrum/s2";
import Add from "@react-spectrum/s2/icons/Add";
import Apps from "@react-spectrum/s2/icons/Apps";
import BrightnessContrast from "@react-spectrum/s2/icons/BrightnessContrast";
import DeviceDesktop from "@react-spectrum/s2/icons/DeviceDesktop";
import More from "@react-spectrum/s2/icons/More";
import Sort from "@react-spectrum/s2/icons/Sort";
import SortDown from "@react-spectrum/s2/icons/SortDown";
import SortUp from "@react-spectrum/s2/icons/SortUp";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "@react-spectrum/s2/page.css";
import { retainVisibleRows, selectRow, selectRowForContextMenu } from "./row-selection";
import { AppIcon } from "./app-icon";
import "./App.css";

type Desktop = { index: number; name: string; current: boolean };
type WindowInfo = {
  hwnd: number;
  title: string;
  app_name: string;
  desktop_index: number;
  minimized: boolean;
  pinned: boolean;
};
type Snapshot = { desktops: Desktop[]; windows: WindowInfo[] };
type WindowSortKey = "title" | "app_name" | "desktop_index" | "state";
type WindowSort = { column: WindowSortKey; direction: "ascending" | "descending" };
const windowCollator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

function WindowSortHeader({
  column,
  label,
  sort,
  onSort,
}: {
  column: WindowSortKey;
  label: string;
  sort: WindowSort;
  onSort: (column: WindowSortKey) => void;
}) {
  const active = sort.column === column;
  const nextDirection = active && sort.direction === "ascending" ? "降順" : "昇順";
  const Icon = active ? (sort.direction === "ascending" ? SortUp : SortDown) : Sort;
  return (
    <th scope="col" aria-sort={active ? sort.direction : "none"} data-window-sort>
      <button
        type="button"
        className="window-sort-button"
        aria-label={`${label}で${nextDirection}に並べ替え`}
        onClick={() => onSort(column)}
      >
        <span>{label}</span>
        <Icon aria-hidden="true" />
      </button>
    </th>
  );
}
type ContextTarget = { kind: "window"; hwnd: number } | { kind: "desktop"; index: number };
type ContextMenuState = ContextTarget & {
  x: number;
  y: number;
  placement: "bottom start" | "bottom end";
  requestId: number;
};

const toastQueue = ToastQueue;
const fullWidth = style({ width: "full", minWidth: 0 });
const providerLayout = style({ width: "full", height: "full", minHeight: 0 });

export function App() {
  const [dark, setDark] = useState(() => localStorage.getItem("theme") === "dark");
  const [snapshot, setSnapshot] = useState<Snapshot>({ desktops: [], windows: [] });
  const [windowSelection, setWindowSelection] = useState<{
    ids: ReadonlySet<number>;
    anchorId: number | null;
  }>({ ids: new Set(), anchorId: null });
  const [query, setQuery] = useState("");
  const [appFilter, setAppFilter] = useState("all");
  const [desktopFilter, setDesktopFilter] = useState("selected");
  const [excludeMinimized, setExcludeMinimized] = useState(false);
  const [windowSort, setWindowSort] = useState<WindowSort>({
    column: "title",
    direction: "ascending",
  });
  const [selectedDesktop, setSelectedDesktop] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | null
    | { kind: "create" }
    | { kind: "rename"; index: number }
    | { kind: "delete"; index: number }
  >(null);
  const [dialogValue, setDialogValue] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuTriggerRef = useRef<HTMLElement | null>(null);
  const contextMenuSequence = useRef(0);
  const pendingContextTarget = useRef<ContextTarget | null>(null);

  useEffect(() => {
    const clearSelection = () => {
      setWindowSelection((selection) =>
        selection.ids.size || selection.anchorId !== null
          ? { ids: new Set(), anchorId: null }
          : selection,
      );
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button === 2) {
        pendingContextTarget.current = contextMenu
          ? contextMenu.kind === "window"
            ? { kind: "window", hwnd: contextMenu.hwnd }
            : { kind: "desktop", index: contextMenu.index }
          : null;
        return;
      }

      pendingContextTarget.current = null;
      const target = event.composedPath().find((node): node is Element => node instanceof Element);
      if (
        target?.closest(
          ".quick-context-menu, .context-menu-content, [data-trigger='SubmenuTrigger']",
        )
      ) {
        return;
      }

      setContextMenu(null);
      if (!target?.closest("[data-window-hwnd], [data-window-sort]")) clearSelection();
    };
    // ポータルやライブラリが伝播を止める前に捕捉する。
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    const dismiss = () => {
      setContextMenu(null);
      pendingContextTarget.current = null;
      setWindowSelection((selection) =>
        selection.ids.size || selection.anchorId !== null
          ? { ids: new Set(), anchorId: null }
          : selection,
      );
    };
    window.addEventListener("blur", dismiss);

    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      // WebView内のフォーカス移動に加え、Windowsのウィンドウ非アクティブ化も拾う。
      void getCurrentWindow()
        .onFocusChanged(({ payload: focused }) => {
          if (!focused) dismiss();
        })
        .then((stop) => {
          if (disposed) stop();
          else unlisten = stop;
        })
        .catch((reason) => {
          if (!disposed) toastQueue.negative(`ウィンドウのフォーカスを監視できません: ${reason}`);
        });
    }
    return () => {
      disposed = true;
      window.removeEventListener("blur", dismiss);
      unlisten?.();
    };
  }, []);

  const refresh = async () => {
    try {
      const next = await invoke<Snapshot>("get_snapshot");
      setSnapshot(next);
      setSelectedDesktop((selected) =>
        selected !== null && !next.desktops.some((desktop) => desktop.index === selected)
          ? (next.desktops.find((desktop) => desktop.current)?.index ?? null)
          : selected,
      );
      setError(null);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  const current = snapshot.desktops.find((desktop) => desktop.current);
  const activeDesktop = selectedDesktop ?? current?.index ?? null;
  const apps = [...new Set(snapshot.windows.map((window) => window.app_name))].sort();
  const visibleWindows = useMemo(
    () =>
      snapshot.windows
        .filter((window) => {
          const matchesText = `${window.title} ${window.app_name}`
            .toLowerCase()
            .includes(query.toLowerCase());
          const matchesApp = appFilter === "all" || window.app_name === appFilter;
          const matchesDesktop =
            desktopFilter === "all" ||
            (desktopFilter === "current" && window.desktop_index === current?.index) ||
            (desktopFilter === "selected" && window.desktop_index === activeDesktop);
          return (
            matchesText && matchesApp && matchesDesktop && (!excludeMinimized || !window.minimized)
          );
        })
        .sort((left, right) => {
          let comparison: number;
          if (windowSort.column === "desktop_index") {
            comparison = left.desktop_index - right.desktop_index;
          } else if (windowSort.column === "state") {
            comparison =
              Number(left.minimized) * 2 +
              Number(left.pinned) -
              (Number(right.minimized) * 2 + Number(right.pinned));
          } else {
            const leftValue =
              windowSort.column === "title" ? left.title || left.app_name : left.app_name;
            const rightValue =
              windowSort.column === "title" ? right.title || right.app_name : right.app_name;
            comparison = windowCollator.compare(leftValue, rightValue);
          }
          // 更新時の列挙順に左右されないよう、同値はウィンドウIDで順序を固定する。
          return comparison === 0
            ? left.hwnd - right.hwnd
            : comparison * (windowSort.direction === "ascending" ? 1 : -1);
        }),
    [
      snapshot.windows,
      query,
      appFilter,
      desktopFilter,
      excludeMinimized,
      current?.index,
      activeDesktop,
      windowSort,
    ],
  );
  const visibleWindowIds = useMemo(
    () => visibleWindows.map((window) => window.hwnd),
    [visibleWindows],
  );
  const selectedWindowCount = windowSelection.ids.size;

  const toggleWindowSort = (column: WindowSortKey) => {
    setWindowSort((sort) => ({
      column,
      direction:
        sort.column === column && sort.direction === "ascending" ? "descending" : "ascending",
    }));
  };

  useEffect(() => {
    setWindowSelection((selection) => retainVisibleRows(selection, visibleWindowIds));
  }, [visibleWindowIds]);

  const run = async (command: string, args: Record<string, unknown> = {}) => {
    try {
      await invoke(command, args);
      await refresh();
    } catch (reason) {
      toastQueue.negative(String(reason));
    }
  };

  const runWindowBatch = async (
    windows: WindowInfo[],
    action: (window: WindowInfo) => { command: string; args: Record<string, unknown> },
  ) => {
    const failures: string[] = [];
    for (const window of windows) {
      const { command, args } = action(window);
      try {
        await invoke(command, args);
      } catch (reason) {
        failures.push(String(reason));
      }
    }
    await refresh();
    if (failures.length) {
      toastQueue.negative(
        `${failures.length} 件のウィンドウを操作できませんでした: ${failures[0]}`,
      );
    }
  };

  const renameDesktop = async (index: number, name: string) => {
    if (name.trim()) await run("rename_desktop", { index, name: name.trim() });
  };

  const openRename = (desktop: Desktop) => {
    setDialogValue(desktop.name || `デスクトップ ${desktop.index + 1}`);
    setDialog({ kind: "rename", index: desktop.index });
  };

  const confirmDialog = async () => {
    if (!dialog) return;
    if (dialog.kind === "create") await run("create_desktop");
    if (dialog.kind === "rename") await renameDesktop(dialog.index, dialogValue);
    if (dialog.kind === "delete") await run("remove_desktop", { index: dialog.index });
    setDialog(null);
  };

  const desktopName = (index: number) =>
    snapshot.desktops.find((item) => item.index === index)?.name || `デスクトップ ${index + 1}`;

  const showContextMenu = (
    target: ContextTarget,
    x: number,
    y: number,
    placement: ContextMenuState["placement"] = "bottom start",
    trigger?: HTMLElement | null,
  ) => {
    contextMenuSequence.current += 1;
    if (trigger) contextMenuTriggerRef.current = trigger;
    setContextMenu({ ...target, x, y, placement, requestId: contextMenuSequence.current });
    pendingContextTarget.current = null;
  };

  const contextWindow =
    contextMenu?.kind === "window"
      ? snapshot.windows.find((window) => window.hwnd === contextMenu.hwnd)
      : undefined;
  const contextWindows = contextWindow
    ? windowSelection.ids.has(contextWindow.hwnd)
      ? visibleWindows.filter((window) => windowSelection.ids.has(window.hwnd))
      : [contextWindow]
    : [];
  const contextAllPinned =
    contextWindows.length > 0 && contextWindows.every((window) => window.pinned);
  const contextMoveDestinations = snapshot.desktops.filter((desktop) =>
    contextWindows.some((window) => window.desktop_index !== desktop.index),
  );
  const contextSelectionLabel =
    contextWindows.length > 1 ? `選択した${contextWindows.length}件を` : "このウィンドウを";
  const contextPinLabel = contextAllPinned
    ? contextWindows.length > 1
      ? `選択した${contextWindows.length}件の固定を解除`
      : "このウィンドウの固定を解除"
    : `${contextSelectionLabel}すべてのデスクトップに表示`;

  const handleContextMenuAction = (key: React.Key) => {
    const menu = contextMenu;
    setContextMenu(null);
    pendingContextTarget.current = null;
    if (!menu) return;

    if (menu.kind === "desktop") {
      if (key === "switch") void run("switch_desktop", { index: menu.index });
      if (key === "rename") {
        const desktop = snapshot.desktops.find((item) => item.index === menu.index);
        if (desktop) openRename(desktop);
      }
      if (key === "delete") setDialog({ kind: "delete", index: menu.index });
      return;
    }

    if (typeof key === "string" && key.startsWith("move:")) {
      const desktopIndex = Number(key.slice("move:".length));
      void runWindowBatch(contextWindows, (window) => ({
        command: "move_window",
        args: { hwnd: window.hwnd, desktopIndex },
      }));
    }
    if (key === "pin") {
      void runWindowBatch(
        contextWindows.filter((window) => window.pinned !== !contextAllPinned),
        (window) => ({
          command: contextAllPinned ? "unpin_window" : "pin_window",
          args: { hwnd: window.hwnd },
        }),
      );
    }
    if (key === "close") {
      void runWindowBatch(contextWindows, (window) => ({
        command: "close_window",
        args: { hwnd: window.hwnd },
      }));
    }
  };

  return (
    <Provider colorScheme={dark ? "dark" : "light"} locale="ja-JP" styles={providerLayout}>
      <div
        className="app-shell"
        data-theme={dark ? "dark" : "light"}
        onContextMenuCapture={(event) => {
          const target = event.target instanceof Element ? event.target : null;
          const windowRow = target?.closest<HTMLElement>("[data-window-hwnd]");
          if (windowRow) {
            const hwnd = Number(windowRow.dataset.windowHwnd);
            if (Number.isFinite(hwnd)) {
              event.preventDefault();
              setWindowSelection((selection) => selectRowForContextMenu(selection, hwnd));
              showContextMenu(
                { kind: "window", hwnd },
                event.clientX,
                event.clientY,
                "bottom start",
                windowRow.querySelector(".window-title"),
              );
              return;
            }
          }

          const desktopEntry = target?.closest<HTMLElement>("[data-desktop-index]");
          if (desktopEntry) {
            const index = Number(desktopEntry.dataset.desktopIndex);
            if (Number.isFinite(index)) {
              event.preventDefault();
              showContextMenu(
                { kind: "desktop", index },
                event.clientX,
                event.clientY,
                "bottom start",
                desktopEntry.querySelector(".desktop-select"),
              );
              return;
            }
          }

          const reopenTarget =
            pendingContextTarget.current ??
            (contextMenu
              ? contextMenu.kind === "window"
                ? { kind: "window", hwnd: contextMenu.hwnd }
                : { kind: "desktop", index: contextMenu.index }
              : null);
          if (reopenTarget) {
            event.preventDefault();
            showContextMenu(reopenTarget, event.clientX, event.clientY);
          }
        }}
      >
        <header className="topbar">
          <div className="brand-mark" aria-hidden="true">
            <Apps />
          </div>
          <span className="brand-name">Inter Desktop</span>
          <ActionButton
            size="S"
            isQuiet
            aria-label={dark ? "ライトモードに切り替え" : "ダークモードに切り替え"}
            onPress={() => setDark((value) => !value)}
          >
            <BrightnessContrast />
          </ActionButton>
        </header>

        <div className="app-body">
          <aside className="sidebar">
            <div className="sidebar-heading">
              <span>デスクトップ</span>
              <ActionButton
                size="XS"
                isQuiet
                aria-label="デスクトップを追加"
                onPress={() => setDialog({ kind: "create" })}
              >
                <Add />
              </ActionButton>
            </div>
            <nav className="desktop-list" aria-label="仮想デスクトップ">
              {snapshot.desktops.map((desktop) => {
                const name = desktopName(desktop.index);
                const count = snapshot.windows.filter(
                  (item) => item.desktop_index === desktop.index,
                ).length;
                return (
                  <div
                    key={desktop.index}
                    className={`desktop-entry ${activeDesktop === desktop.index ? "is-selected" : ""}`}
                    data-desktop-index={desktop.index}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const hwnd = Number(event.dataTransfer.getData("text/window-hwnd"));
                      if (hwnd) void run("move_window", { hwnd, desktopIndex: desktop.index });
                    }}
                  >
                    <button
                      className="desktop-select"
                      title={name}
                      aria-pressed={activeDesktop === desktop.index}
                      onClick={() => setSelectedDesktop(desktop.index)}
                      onDoubleClick={() => void run("switch_desktop", { index: desktop.index })}
                    >
                      <span className={`desktop-icon ${desktop.current ? "current" : ""}`}>
                        <DeviceDesktop aria-hidden="true" />
                      </span>
                      <span className="desktop-name">{name}</span>
                      <span className="desktop-count" aria-label={`${count} ウィンドウ`}>
                        {count}
                      </span>
                    </button>
                    <ActionButton
                      size="XS"
                      isQuiet
                      aria-label={`${name} の操作`}
                      onPress={(event) => {
                        const trigger = event.target.closest<HTMLElement>("button");
                        if (!trigger) return;
                        const rect = trigger.getBoundingClientRect();
                        showContextMenu(
                          { kind: "desktop", index: desktop.index },
                          rect.right,
                          rect.bottom,
                          "bottom end",
                          trigger,
                        );
                      }}
                    >
                      <More />
                    </ActionButton>
                  </div>
                );
              })}
              {!snapshot.desktops.length && !loading && (
                <p className="sidebar-empty">デスクトップを取得できません</p>
              )}
            </nav>
            <p className="sidebar-footer">
              右クリックで操作
              <br />
              ドラッグして移動
            </p>
          </aside>

          <main className="main-content">
            <div className="content-heading">
              <div className="heading-copy">
                <h1 title={activeDesktop === null ? "ウィンドウ" : desktopName(activeDesktop)}>
                  {activeDesktop === null ? "ウィンドウ" : desktopName(activeDesktop)}
                </h1>
                <p
                  className="current-desktop"
                  title={current ? desktopName(current.index) : undefined}
                >
                  {current
                    ? `現在のデスクトップ：${desktopName(current.index)}`
                    : "Windowsの仮想デスクトップを管理"}
                </p>
              </div>
              <DialogTrigger
                isOpen={dialog !== null}
                onOpenChange={(isOpen) => {
                  if (!isOpen) setDialog(null);
                }}
              >
                <Button size="S" variant="accent" onPress={() => setDialog({ kind: "create" })}>
                  <Add />
                  <Text>デスクトップを追加</Text>
                </Button>
                <Dialog>
                  <Heading>
                    {dialog?.kind === "rename"
                      ? "名前を変更"
                      : dialog?.kind === "delete"
                        ? "デスクトップを削除"
                        : "デスクトップを追加"}
                  </Heading>
                  <Text>
                    {dialog?.kind === "delete"
                      ? `「${desktopName(dialog.index)}」を削除します。ウィンドウは別のデスクトップへ移動します。`
                      : dialog?.kind === "rename"
                        ? "新しい名前を入力してください。"
                        : "新しい仮想デスクトップを作成します。"}
                  </Text>
                  {dialog?.kind === "rename" && (
                    <TextField
                      label="デスクトップ名"
                      value={dialogValue}
                      onChange={setDialogValue}
                      autoFocus
                    />
                  )}
                  <Button
                    slot="close"
                    variant={dialog?.kind === "delete" ? "negative" : "accent"}
                    onPress={() => void confirmDialog()}
                  >
                    {dialog?.kind === "rename"
                      ? "保存"
                      : dialog?.kind === "delete"
                        ? "削除"
                        : "作成"}
                  </Button>
                </Dialog>
              </DialogTrigger>
            </div>

            <section className="filters" aria-label="ウィンドウの絞り込み">
              <div className="filter-search">
                <SearchField
                  size="S"
                  styles={fullWidth}
                  aria-label="ウィンドウ名・アプリ名で検索"
                  placeholder="ウィンドウ名・アプリ名で検索"
                  value={query}
                  onChange={setQuery}
                />
              </div>
              <div className="filter-options">
                <div className="filter-app">
                  <Picker
                    size="S"
                    styles={fullWidth}
                    aria-label="アプリで絞り込み"
                    selectedKey={appFilter}
                    onSelectionChange={(key) => setAppFilter(String(key))}
                  >
                    <PickerItem id="all">すべてのアプリ</PickerItem>
                    {apps.map((app) => (
                      <PickerItem key={app} id={app}>
                        {app}
                      </PickerItem>
                    ))}
                  </Picker>
                </div>
                <div className="filter-desktop">
                  <Picker
                    size="S"
                    styles={fullWidth}
                    aria-label="デスクトップで絞り込み"
                    selectedKey={desktopFilter}
                    onSelectionChange={(key) => setDesktopFilter(String(key))}
                  >
                    <PickerItem id="current">現在のデスクトップ</PickerItem>
                    <PickerItem id="selected">選択したデスクトップ</PickerItem>
                    <PickerItem id="all">すべてのデスクトップ</PickerItem>
                  </Picker>
                </div>
                <div className="filter-toggle">
                  <Checkbox size="S" isSelected={excludeMinimized} onChange={setExcludeMinimized}>
                    最小化を除く
                  </Checkbox>
                </div>
              </div>
            </section>

            <section className="window-section" aria-labelledby="window-list-heading">
              <div className="section-title">
                <h2 id="window-list-heading">ウィンドウ</h2>
                <span className="window-count" aria-live="polite">
                  {selectedWindowCount
                    ? `${selectedWindowCount} / ${visibleWindows.length} 件を選択中`
                    : `${visibleWindows.length} 件`}
                </span>
              </div>
              <div
                className="window-list"
                role="region"
                aria-label="ウィンドウ一覧。クリックで選択、CtrlまたはShiftを押しながらクリックで複数選択"
                tabIndex={0}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
                    event.preventDefault();
                    setWindowSelection({
                      ids: new Set(visibleWindowIds),
                      anchorId: visibleWindowIds[0] ?? null,
                    });
                  }
                  if (event.key === "Escape") {
                    setWindowSelection({ ids: new Set(), anchorId: null });
                    setContextMenu(null);
                  }
                }}
              >
                {error && (
                  <div className="error-panel">
                    <strong>仮想デスクトップAPIに接続できません</strong>
                    <p>{error}</p>
                    <Button size="S" onPress={() => void refresh()}>
                      再試行
                    </Button>
                  </div>
                )}
                {!error && loading && (
                  <div className="empty-panel" role="status">
                    ウィンドウを読み込み中…
                  </div>
                )}
                {!error && !loading && visibleWindows.length === 0 && (
                  <div className="empty-panel">
                    表示するウィンドウがありません。検索条件を変更してください。
                  </div>
                )}
                {!error && !loading && visibleWindows.length > 0 && (
                  <table className="window-table" aria-label="ウィンドウ一覧">
                    <colgroup>
                      <col className="window-app-column" />
                      <col />
                      {desktopFilter === "all" && <col className="window-desktop-column" />}
                      <col className="window-state-column" />
                      <col className="window-actions-column" />
                    </colgroup>
                    <thead>
                      <tr>
                        <WindowSortHeader
                          column="app_name"
                          label="アプリ"
                          sort={windowSort}
                          onSort={toggleWindowSort}
                        />
                        <WindowSortHeader
                          column="title"
                          label="ウィンドウ"
                          sort={windowSort}
                          onSort={toggleWindowSort}
                        />
                        {desktopFilter === "all" && (
                          <WindowSortHeader
                            column="desktop_index"
                            label="デスクトップ"
                            sort={windowSort}
                            onSort={toggleWindowSort}
                          />
                        )}
                        <WindowSortHeader
                          column="state"
                          label="状態"
                          sort={windowSort}
                          onSort={toggleWindowSort}
                        />
                        <th scope="col" aria-label="操作" />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleWindows.map((item) => {
                        const isSelected = windowSelection.ids.has(item.hwnd);
                        return (
                          <tr
                            key={item.hwnd}
                            className={`window-row ${isSelected ? "is-selected" : ""}`}
                            data-window-hwnd={item.hwnd}
                            draggable
                            onClick={(event) => {
                              if ((event.target as HTMLElement).closest("button")) return;
                              setWindowSelection((selection) =>
                                selectRow(selection, item.hwnd, visibleWindowIds, {
                                  toggle: event.ctrlKey || event.metaKey,
                                  range: event.shiftKey,
                                }),
                              );
                            }}
                            onDragStart={(event) =>
                              event.dataTransfer.setData("text/window-hwnd", String(item.hwnd))
                            }
                          >
                            <td
                              className="window-app-cell"
                              aria-label={item.app_name}
                              title={item.app_name}
                            >
                              <AppIcon hwnd={item.hwnd} appName={item.app_name} />
                            </td>
                            <td>
                              <button
                                type="button"
                                className="window-title"
                                aria-pressed={isSelected}
                                title={`${item.title || item.app_name}\n${item.app_name}`}
                                onClick={(event) =>
                                  setWindowSelection((selection) =>
                                    selectRow(selection, item.hwnd, visibleWindowIds, {
                                      toggle: event.ctrlKey || event.metaKey,
                                      range: event.shiftKey,
                                    }),
                                  )
                                }
                              >
                                {item.title || item.app_name}
                              </button>
                            </td>
                            {desktopFilter === "all" && (
                              <td>
                                <span
                                  className="window-desktop"
                                  title={desktopName(item.desktop_index)}
                                >
                                  {desktopName(item.desktop_index)}
                                </span>
                              </td>
                            )}
                            <td>
                              <span className="window-status">
                                {item.pinned && (
                                  <span className="window-state" title="すべてのデスクトップに表示">
                                    固定
                                  </span>
                                )}
                                {item.minimized && <span className="window-state">最小化</span>}
                              </span>
                            </td>
                            <td className="window-actions-cell">
                              <ActionButton
                                size="XS"
                                isQuiet
                                aria-label={`${item.title || item.app_name} の操作`}
                                onPress={(event) => {
                                  const trigger = event.target.closest<HTMLElement>("button");
                                  if (!trigger) return;
                                  setWindowSelection((selection) =>
                                    selectRowForContextMenu(selection, item.hwnd),
                                  );
                                  const rect = trigger.getBoundingClientRect();
                                  showContextMenu(
                                    { kind: "window", hwnd: item.hwnd },
                                    rect.right,
                                    rect.bottom,
                                    "bottom end",
                                    trigger,
                                  );
                                }}
                              >
                                <More />
                              </ActionButton>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </main>
        </div>
        <Popover
          key={contextMenu?.requestId ?? 0}
          isOpen={contextMenu !== null}
          triggerRef={contextMenuTriggerRef}
          onOpenChange={(isOpen) => {
            if (!isOpen) setContextMenu(null);
          }}
          getTargetRect={() =>
            contextMenu ? new DOMRect(contextMenu.x, contextMenu.y, 0, 0) : new DOMRect()
          }
          placement={contextMenu?.placement ?? "bottom start"}
          offset={2}
          containerPadding={8}
          shouldFlip
          hideArrow
          isNonModal
          UNSAFE_className="quick-context-menu"
        >
          {contextMenu?.kind === "desktop" && (
            <Menu
              size="S"
              UNSAFE_className="context-menu-content"
              aria-label={`${desktopName(contextMenu.index)} の操作`}
              onAction={handleContextMenuAction}
            >
              <MenuItem id="switch">このデスクトップに切り替え</MenuItem>
              <MenuItem id="rename">名前を変更</MenuItem>
              <MenuItem id="delete" isDisabled={snapshot.desktops.length <= 1}>
                デスクトップを削除
              </MenuItem>
            </Menu>
          )}
          {contextMenu?.kind === "window" && (
            <Menu
              size="S"
              UNSAFE_className="context-menu-content"
              aria-label="ウィンドウの操作"
              onAction={handleContextMenuAction}
            >
              <SubmenuTrigger>
                <MenuItem id="move" isDisabled={!contextMoveDestinations.length}>
                  {contextWindows.length > 1
                    ? `選択した${contextWindows.length}件の移動先`
                    : "移動先を選択"}
                </MenuItem>
                <Menu
                  size="S"
                  UNSAFE_className="context-menu-content"
                  aria-label="移動先"
                  onAction={handleContextMenuAction}
                >
                  {contextMoveDestinations.map((desktop) => (
                    <MenuItem
                      key={desktop.index}
                      id={`move:${desktop.index}`}
                      textValue={`${desktopName(desktop.index)}へ移動`}
                    >
                      <span
                        slot="label"
                        className="context-menu-label"
                        title={desktopName(desktop.index)}
                      >
                        {desktopName(desktop.index)}へ移動
                      </span>
                    </MenuItem>
                  ))}
                </Menu>
              </SubmenuTrigger>
              <MenuItem id="pin">{contextPinLabel}</MenuItem>
              <MenuItem id="close">{`${contextSelectionLabel}閉じる`}</MenuItem>
            </Menu>
          )}
        </Popover>
        <ToastContainer />
      </div>
    </Provider>
  );
}
