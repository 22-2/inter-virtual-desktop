import { useEffect, useMemo, useState } from "react";
import {
  ActionButton,
  Button,
  Checkbox,
  Dialog,
  DialogTrigger,
  Heading,
  Menu,
  MenuItem,
  MenuTrigger,
  Picker,
  PickerItem,
  Provider,
  SearchField,
  Text,
  TextField,
  ToastContainer,
  ToastQueue,
} from "@react-spectrum/s2";
import Add from "@react-spectrum/s2/icons/Add";
import Apps from "@react-spectrum/s2/icons/Apps";
import BrightnessContrast from "@react-spectrum/s2/icons/BrightnessContrast";
import More from "@react-spectrum/s2/icons/More";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import { invoke } from "@tauri-apps/api/core";
import "@react-spectrum/s2/page.css";
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

const toastQueue = ToastQueue;
const fullWidth = style({ width: "full", minWidth: 0 });
const providerLayout = style({ width: "full", height: "full", minHeight: 0 });

export function App() {
  const [dark, setDark] = useState(() => localStorage.getItem("theme") === "dark");
  const [snapshot, setSnapshot] = useState<Snapshot>({ desktops: [], windows: [] });
  const [query, setQuery] = useState("");
  const [appFilter, setAppFilter] = useState("all");
  const [desktopFilter, setDesktopFilter] = useState("selected");
  const [excludeMinimized, setExcludeMinimized] = useState(false);
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
  const [openMenu, setOpenMenu] = useState<string | null>(null);

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
      snapshot.windows.filter((window) => {
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
      }),
    [
      snapshot.windows,
      query,
      appFilter,
      desktopFilter,
      excludeMinimized,
      current?.index,
      activeDesktop,
    ],
  );

  const run = async (command: string, args: Record<string, unknown> = {}) => {
    try {
      await invoke(command, args);
      await refresh();
    } catch (reason) {
      toastQueue.negative(String(reason));
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

  return (
    <Provider colorScheme={dark ? "dark" : "light"} locale="ja-JP" styles={providerLayout}>
      <div className="app-shell" data-theme={dark ? "dark" : "light"}>
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
                const menuId = `desktop-${desktop.index}`;
                const count = snapshot.windows.filter(
                  (item) => item.desktop_index === desktop.index,
                ).length;
                return (
                  <div
                    key={desktop.index}
                    className={`desktop-entry ${activeDesktop === desktop.index ? "is-selected" : ""}`}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setOpenMenu(menuId);
                    }}
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
                      <span
                        className={`desktop-dot ${desktop.current ? "current" : ""}`}
                        aria-hidden="true"
                      />
                      <span className="desktop-name">{name}</span>
                      <span className="desktop-count" aria-label={`${count} ウィンドウ`}>
                        {count}
                      </span>
                    </button>
                    <MenuTrigger
                      isOpen={openMenu === menuId}
                      onOpenChange={(isOpen) => setOpenMenu(isOpen ? menuId : null)}
                      align="end"
                    >
                      <ActionButton size="XS" isQuiet aria-label={`${name} の操作`}>
                        <More />
                      </ActionButton>
                      <Menu
                        size="S"
                        onAction={(key) => {
                          if (key === "switch")
                            void run("switch_desktop", { index: desktop.index });
                          if (key === "rename") openRename(desktop);
                          if (key === "delete") setDialog({ kind: "delete", index: desktop.index });
                        }}
                      >
                        <MenuItem id="switch">このデスクトップに切り替え</MenuItem>
                        <MenuItem id="rename">名前を変更</MenuItem>
                        <MenuItem id="delete" isDisabled={snapshot.desktops.length <= 1}>
                          デスクトップを削除
                        </MenuItem>
                      </Menu>
                    </MenuTrigger>
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
                <span className="window-count">{visibleWindows.length} 件</span>
              </div>
              <div className="window-list" role="region" aria-label="ウィンドウ一覧" tabIndex={0}>
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
                {!error &&
                  visibleWindows.map((item) => {
                    const menuId = `window-${item.hwnd}`;
                    return (
                      <div
                        key={item.hwnd}
                        className="window-row"
                        draggable
                        onDragStart={(event) =>
                          event.dataTransfer.setData("text/window-hwnd", String(item.hwnd))
                        }
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setOpenMenu(menuId);
                        }}
                      >
                        <span
                          className={`app-icon ${item.app_name.toLowerCase().includes("explorer") ? "explorer" : ""}`}
                          aria-hidden="true"
                        >
                          {item.app_name.slice(0, 1).toUpperCase()}
                        </span>
                        <span
                          className="window-title"
                          title={`${item.title || item.app_name}\n${item.app_name}`}
                        >
                          {item.title || item.app_name}
                        </span>
                        <span className="window-status">
                          {desktopFilter === "all" && (
                            <span
                              className="window-desktop"
                              title={desktopName(item.desktop_index)}
                            >
                              {desktopName(item.desktop_index)}
                            </span>
                          )}
                          {item.pinned && (
                            <span className="window-state" title="すべてのデスクトップに表示">
                              固定
                            </span>
                          )}
                          {item.minimized && <span className="window-state">最小化</span>}
                        </span>
                        <MenuTrigger
                          isOpen={openMenu === menuId}
                          onOpenChange={(isOpen) => setOpenMenu(isOpen ? menuId : null)}
                          align="end"
                        >
                          <ActionButton size="XS" isQuiet aria-label={`${item.title} の操作`}>
                            <More />
                          </ActionButton>
                          <Menu
                            size="S"
                            onAction={(key) => {
                              if (key === "move") {
                                const destination = snapshot.desktops.find(
                                  (desktop) => desktop.index !== item.desktop_index,
                                );
                                if (destination)
                                  void run("move_window", {
                                    hwnd: item.hwnd,
                                    desktopIndex: destination.index,
                                  });
                              }
                              if (key === "pin")
                                void run(item.pinned ? "unpin_window" : "pin_window", {
                                  hwnd: item.hwnd,
                                });
                              if (key === "close") void run("close_window", { hwnd: item.hwnd });
                            }}
                          >
                            <MenuItem id="move" isDisabled={snapshot.desktops.length <= 1}>
                              別のデスクトップへ移動
                            </MenuItem>
                            <MenuItem id="pin">
                              {item.pinned
                                ? "このウィンドウの固定を解除"
                                : "このウィンドウをすべてのデスクトップに表示"}
                            </MenuItem>
                            <MenuItem id="close">ウィンドウを閉じる</MenuItem>
                          </Menu>
                        </MenuTrigger>
                      </div>
                    );
                  })}
              </div>
            </section>
          </main>
        </div>
        <ToastContainer />
      </div>
    </Provider>
  );
}
