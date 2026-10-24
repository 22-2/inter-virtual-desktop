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
  StatusLight,
  Text,
  TextField,
  ToastContainer,
  ToastQueue,
} from "@react-spectrum/s2";
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
  const [dialog, setDialog] = useState<null | { kind: "create" } | { kind: "rename"; index: number } | { kind: "delete"; index: number }>(null);
  const [dialogValue, setDialogValue] = useState("");

  const refresh = async () => {
    try {
      const next = await invoke<Snapshot>("get_snapshot");
      setSnapshot(next);
      setSelectedDesktop((selected) => selected !== null && !next.desktops.some((desktop) => desktop.index === selected)
        ? next.desktops.find((desktop) => desktop.current)?.index ?? null
        : selected);
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
  const visibleWindows = useMemo(() => snapshot.windows.filter((window) => {
    const matchesText = `${window.title} ${window.app_name}`.toLowerCase().includes(query.toLowerCase());
    const matchesApp = appFilter === "all" || window.app_name === appFilter;
    const matchesDesktop = desktopFilter === "all"
      || (desktopFilter === "current" && window.desktop_index === current?.index)
      || (desktopFilter === "selected" && window.desktop_index === activeDesktop);
    return matchesText && matchesApp && matchesDesktop && (!excludeMinimized || !window.minimized);
  }), [snapshot.windows, query, appFilter, desktopFilter, excludeMinimized, current?.index, activeDesktop]);

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

  const desktopName = (index: number) => snapshot.desktops.find((item) => item.index === index)?.name || `デスクトップ ${index + 1}`;

  return (
    <Provider colorScheme={dark ? "dark" : "light"} locale="ja-JP">
      <div className="app-shell">
        <header className="topbar">
          <div className="brand-mark">▦</div>
          <Text UNSAFE_className="brand-name">Inter Desktop</Text>
          <div className="topbar-spacer" />
          <ActionButton isQuiet aria-label="テーマ切り替え" onPress={() => setDark((value) => !value)}>
            {dark ? "☼" : "◐"}
          </ActionButton>
          <div className="profile">IV</div>
        </header>

        <div className="app-body">
          <aside className="sidebar">
            <div className="sidebar-heading">
              <Text>デスクトップ</Text>
              <ActionButton isQuiet aria-label="デスクトップを追加" onPress={() => setDialog({ kind: "create" })}>＋</ActionButton>
            </div>
            <nav className="desktop-list" aria-label="仮想デスクトップ">
              {snapshot.desktops.map((desktop) => (
                <MenuTrigger key={desktop.index} trigger="contextMenu">
                <div
                  className={`desktop-entry ${activeDesktop === desktop.index ? "is-selected" : ""} ${desktop.current ? "is-current" : ""}`}
                  onClick={() => setSelectedDesktop(desktop.index)}
                  onDoubleClick={() => void run("switch_desktop", { index: desktop.index })}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const hwnd = Number(event.dataTransfer.getData("text/window-hwnd"));
                    if (hwnd) void run("move_window", { hwnd, desktopIndex: desktop.index });
                  }}
                >
                  <div className={`desktop-dot ${desktop.current ? "current" : ""}`} />
                  <Text UNSAFE_className="desktop-name">{desktop.name || `デスクトップ ${desktop.index + 1}`}</Text>
                  <span className="desktop-count">{snapshot.windows.filter((item) => item.desktop_index === desktop.index).length}</span>
                  <MenuTrigger>
                    <ActionButton isQuiet aria-label={`${desktopName(desktop.index)} の操作`}>⋯</ActionButton>
                    <Menu onAction={(key) => {
                      if (key === "switch") void run("switch_desktop", { index: desktop.index });
                      if (key === "rename") openRename(desktop);
                      if (key === "delete") setDialog({ kind: "delete", index: desktop.index });
                    }}>
                      <MenuItem id="switch">このデスクトップに切り替え</MenuItem>
                      <MenuItem id="rename">名前を変更</MenuItem>
                      <MenuItem id="delete" isDisabled={snapshot.desktops.length <= 1}>デスクトップを削除</MenuItem>
                    </Menu>
                  </MenuTrigger>
                </div>
                <Menu onAction={(key) => {
                  if (key === "switch") void run("switch_desktop", { index: desktop.index });
                  if (key === "rename") openRename(desktop);
                  if (key === "delete") setDialog({ kind: "delete", index: desktop.index });
                }}>
                  <MenuItem id="switch">このデスクトップに切り替え</MenuItem>
                  <MenuItem id="rename">名前を変更</MenuItem>
                  <MenuItem id="delete" isDisabled={snapshot.desktops.length <= 1}>デスクトップを削除</MenuItem>
                </Menu>
                </MenuTrigger>
              ))}
              {!snapshot.desktops.length && !loading && <Text UNSAFE_className="muted sidebar-empty">デスクトップを取得できません</Text>}
            </nav>
            <div className="sidebar-footer">
              <span className="drop-indicator">↳</span>
              <Text>ウィンドウをドラッグして<br />デスクトップへ移動</Text>
            </div>
          </aside>

          <main className="main-content">
            <div className="content-heading">
              <div>
                <Text UNSAFE_className="eyebrow">仮想デスクトップ</Text>
                <Heading level={1}>{activeDesktop === null ? "ウィンドウ" : desktopName(activeDesktop)}</Heading>
                <Text UNSAFE_className="muted">{current ? `現在のデスクトップ：${current.name || `デスクトップ ${current.index + 1}`}` : "Windowsの仮想デスクトップを管理"}</Text>
              </div>
              <DialogTrigger isOpen={dialog !== null} onOpenChange={(isOpen) => { if (!isOpen) setDialog(null); }}>
                <Button variant="accent" onPress={() => setDialog({ kind: "create" })}>＋ デスクトップを追加</Button>
                <Dialog>
                  <Heading>{dialog?.kind === "rename" ? "名前を変更" : dialog?.kind === "delete" ? "デスクトップを削除" : "デスクトップを追加"}</Heading>
                  <Text>{dialog?.kind === "delete" ? `「${desktopName(dialog.index)}」を削除します。ウィンドウは別のデスクトップへ移動します。` : dialog?.kind === "rename" ? "新しい名前を入力してください。" : "新しい仮想デスクトップを作成します。"}</Text>
                  {dialog?.kind === "rename" && <TextField label="デスクトップ名" value={dialogValue} onChange={setDialogValue} autoFocus />}
                  <Button slot="close" variant={dialog?.kind === "delete" ? "negative" : "accent"} onPress={() => void confirmDialog()}>{dialog?.kind === "rename" ? "保存" : dialog?.kind === "delete" ? "削除" : "作成"}</Button>
                </Dialog>
              </DialogTrigger>
            </div>

            <section className="filters" aria-label="ウィンドウの絞り込み">
              <SearchField label="" aria-label="ウィンドウ名・アプリ名で検索" placeholder="ウィンドウ名・アプリ名で検索" value={query} onChange={setQuery} />
              <Picker aria-label="アプリで絞り込み" selectedKey={appFilter} onSelectionChange={(key) => setAppFilter(String(key))}>
                <PickerItem id="all">すべてのアプリ</PickerItem>
                {apps.map((app) => <PickerItem key={app} id={app}>{app}</PickerItem>)}
              </Picker>
              <Picker aria-label="デスクトップで絞り込み" selectedKey={desktopFilter} onSelectionChange={(key) => setDesktopFilter(String(key))}>
                <PickerItem id="current">現在のデスクトップ</PickerItem>
                <PickerItem id="selected">選択したデスクトップ</PickerItem>
                <PickerItem id="all">すべてのデスクトップ</PickerItem>
              </Picker>
              <Checkbox isSelected={excludeMinimized} onChange={setExcludeMinimized}>最小化を除く</Checkbox>
            </section>

            <section className="window-section">
              <div className="section-title">
                <Heading level={3}>{desktopFilter === "all" ? "すべてのウィンドウ" : desktopFilter === "selected" ? "選択したデスクトップのウィンドウ" : "このデスクトップのウィンドウ"}</Heading>
                <Text UNSAFE_className="muted">{visibleWindows.length} 件</Text>
              </div>
              {error && <div className="error-panel"><strong>仮想デスクトップAPIに接続できません</strong><Text>{error}</Text><Button onPress={() => void refresh()}>再試行</Button></div>}
              {!error && loading && <div className="empty-panel">ウィンドウを読み込み中…</div>}
              {!error && !loading && visibleWindows.length === 0 && <div className="empty-panel">表示するウィンドウがありません。検索条件を変更してください。</div>}
              {!error && visibleWindows.length > 0 && <div className="window-list">
                {visibleWindows.map((item) => (
                  <MenuTrigger key={item.hwnd} trigger="contextMenu">
                  <div key={item.hwnd} className="window-row" draggable onDragStart={(event) => event.dataTransfer.setData("text/window-hwnd", String(item.hwnd))}>
                    <Checkbox aria-label={`${item.title} を選択`} />
                    <div className={`app-icon ${item.app_name.toLowerCase().includes("explorer") ? "explorer" : "generic"}`}>{item.app_name.toLowerCase().includes("explorer") ? "▰" : item.app_name.slice(0, 1).toUpperCase()}</div>
                    <div className="window-label">
                      <Text UNSAFE_className="window-title">{item.title || item.app_name}</Text>
                      <Text UNSAFE_className="muted window-app">{item.app_name}{item.minimized ? " · 最小化" : ""}</Text>
                    </div>
                    <StatusLight variant={item.desktop_index === current?.index ? "positive" : "neutral"}>{desktopName(item.desktop_index)}</StatusLight>
                    <MenuTrigger>
                      <ActionButton isQuiet aria-label={`${item.title} の操作`}>⋯</ActionButton>
                      <Menu onAction={(key) => {
                        if (key === "move") {
                          const destination = snapshot.desktops.find((desktop) => desktop.index !== item.desktop_index);
                          if (destination) void run("move_window", { hwnd: item.hwnd, desktopIndex: destination.index });
                        }
                        if (key === "pin") void run(item.pinned ? "unpin_window" : "pin_window", { hwnd: item.hwnd });
                        if (key === "close") void run("close_window", { hwnd: item.hwnd });
                      }}>
                        <MenuItem id="move" isDisabled={snapshot.desktops.length <= 1}>別のデスクトップへ移動</MenuItem>
                        <MenuItem id="pin">{item.pinned ? "このウィンドウの固定を解除" : "このウィンドウをすべてのデスクトップに表示"}</MenuItem>
                        <MenuItem id="close">ウィンドウを閉じる</MenuItem>
                      </Menu>
                    </MenuTrigger>
                  </div>
                  <Menu onAction={(key) => {
                    if (key === "move") {
                      const destination = snapshot.desktops.find((desktop) => desktop.index !== item.desktop_index);
                      if (destination) void run("move_window", { hwnd: item.hwnd, desktopIndex: destination.index });
                    }
                    if (key === "pin") void run(item.pinned ? "unpin_window" : "pin_window", { hwnd: item.hwnd });
                    if (key === "close") void run("close_window", { hwnd: item.hwnd });
                  }}>
                    <MenuItem id="move" isDisabled={snapshot.desktops.length <= 1}>別のデスクトップへ移動</MenuItem>
                    <MenuItem id="pin">{item.pinned ? "このウィンドウの固定を解除" : "このウィンドウをすべてのデスクトップに表示"}</MenuItem>
                    <MenuItem id="close">ウィンドウを閉じる</MenuItem>
                  </Menu>
                  </MenuTrigger>
                ))}
              </div>}
              <Text UNSAFE_className="hint">ウィンドウを右クリック、または「⋯」から操作できます。左のデスクトップへドラッグすると移動します。</Text>
            </section>
          </main>
        </div>
        <ToastContainer />
      </div>
    </Provider>
  );
}
