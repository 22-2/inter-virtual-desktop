import { test as base, expect, type Locator, type Page } from "@playwright/test";

export type Snapshot = {
  desktops: { index: number; name: string; current: boolean }[];
  windows: {
    hwnd: number;
    title: string;
    app_name: string;
    desktop_index: number;
    minimized: boolean;
    pinned: boolean;
  }[];
};
type Call = { command: string; args: Record<string, unknown> };
type IconMode = "valid" | "missing" | "invalid" | "error" | "pending";
type NativeEvent = { event: string; id: number; payload: unknown };

declare global {
  interface Window {
    __E2E__: {
      snapshot: Snapshot;
      calls: Call[];
      failures: Record<string, string>;
      unsupported: string[];
      emitFocus(focused: boolean): number;
      releaseIcon(hwnd: number): void;
    };
  }
}

export const defaultSnapshot: Snapshot = {
  desktops: [
    { index: 0, name: "メイン", current: true },
    { index: 1, name: "🥺調べものの長いデスクトップ名", current: false },
  ],
  windows: [
    {
      hwnd: 101,
      title: "Window 10",
      app_name: "Zebra",
      desktop_index: 0,
      minimized: false,
      pinned: false,
    },
    {
      hwnd: 102,
      title: "Window 2",
      app_name: "Editor",
      desktop_index: 0,
      minimized: true,
      pinned: false,
    },
    {
      hwnd: 103,
      title: "Window 1",
      app_name: "Alpha",
      desktop_index: 0,
      minimized: false,
      pinned: true,
    },
    {
      hwnd: 104,
      title: "日本語のとても長いウィンドウ名".repeat(8),
      app_name: "Browser",
      desktop_index: 0,
      minimized: true,
      pinned: true,
    },
    {
      hwnd: 105,
      title: "Window 2",
      app_name: "Editor",
      desktop_index: 0,
      minimized: false,
      pinned: false,
    },
    {
      hwnd: 106,
      title: "Other desktop",
      app_name: "Explorer",
      desktop_index: 1,
      minimized: false,
      pinned: false,
    },
  ],
};

type App = {
  row(hwnd: number): Locator;
  ids(): Promise<number[]>;
  selectedIds(): Promise<number[]>;
  calls(): Promise<Call[]>;
  refresh(): Promise<void>;
  setSnapshot(snapshot: Snapshot): Promise<void>;
  fail(command: string, message: string | null): Promise<void>;
  nativeFocus(focused: boolean): Promise<number>;
  releaseIcon(hwnd: number): Promise<void>;
};

export const test = base.extend<{
  app: App;
  snapshot: Snapshot;
  icons: Record<number, IconMode>;
}>({
  snapshot: [defaultSnapshot, { option: true }],
  icons: [{}, { option: true }],
  app: async ({ page, snapshot, icons }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install();
    await page.addInitScript(
      ({ snapshot, icons }) => {
        const callbacks = new Map<number, (event: NativeEvent) => void>();
        const listeners = new Map<number, { event: string; handler: number }>();
        const pendingIcons = new Map<number, ((source: string) => void)[]>();
        let nextId = 1;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 32;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#ef8158";
        context.fillRect(4, 4, 24, 24);
        const png = canvas.toDataURL();
        const state: Window["__E2E__"] = {
          snapshot,
          calls: [],
          failures: {},
          unsupported: [],
          emitFocus(focused) {
            let count = 0;
            const event = focused ? "tauri://focus" : "tauri://blur";
            for (const [id, listener] of listeners) {
              if (listener.event === event) {
                callbacks.get(listener.handler)!({ event, id, payload: null });
                count++;
              }
            }
            return count;
          },
          releaseIcon(hwnd) {
            icons[hwnd] = "valid";
            for (const resolve of pendingIcons.get(hwnd) ?? []) resolve(png);
            pendingIcons.delete(hwnd);
          },
        };
        window.__E2E__ = state;
        Object.defineProperty(window, "isTauri", { value: true });
        Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
          value: { unregisterListener: (_event: string, id: number) => listeners.delete(id) },
        });
        Object.defineProperty(window, "__TAURI_INTERNALS__", {
          value: {
            metadata: { currentWindow: { label: "main" } },
            transformCallback(callback: (event: NativeEvent) => void) {
              const id = nextId++;
              callbacks.set(id, callback);
              return id;
            },
            async invoke(command: string, args: Record<string, unknown> = {}) {
              if (command === "plugin:event|listen") {
                const id = nextId++;
                listeners.set(id, { event: String(args.event), handler: Number(args.handler) });
                return id;
              }
              if (command === "plugin:event|unlisten") {
                listeners.delete(Number(args.eventId));
                return;
              }
              if (state.failures[command]) throw new Error(state.failures[command]);
              if (command === "get_snapshot") return structuredClone(state.snapshot);
              const hwnd = Number(args.hwnd);
              if (command === "get_window_icon") {
                switch (icons[hwnd]) {
                  case "valid":
                    return png;
                  case "invalid":
                    return "data:image/png;base64,broken";
                  case "error":
                    throw new Error("アイコン取得失敗のテスト");
                  case "pending":
                    return new Promise<string>((resolve) => {
                      pendingIcons.set(hwnd, [...(pendingIcons.get(hwnd) ?? []), resolve]);
                    });
                  default:
                    return null;
                }
              }
              state.calls.push({ command, args });
              const target = state.snapshot.windows.find((item) => item.hwnd === hwnd);
              switch (command) {
                case "focus_window":
                  if (!target) throw new Error("対象のウィンドウは既に閉じられています。");
                  return;
                case "move_window":
                  if (target) target.desktop_index = Number(args.desktopIndex);
                  return;
                case "pin_window":
                  if (target) target.pinned = true;
                  return;
                case "unpin_window":
                  if (target) target.pinned = false;
                  return;
                case "close_window":
                  state.snapshot.windows = state.snapshot.windows.filter(
                    (item) => item.hwnd !== hwnd,
                  );
                  return;
                case "switch_desktop":
                  state.snapshot.desktops.forEach((desktop) => {
                    desktop.current = desktop.index === Number(args.index);
                  });
                  return;
                case "rename_desktop": {
                  const desktop = state.snapshot.desktops.find(
                    (item) => item.index === Number(args.index),
                  );
                  if (desktop) desktop.name = String(args.name);
                  return;
                }
                case "create_desktop": {
                  const index =
                    Math.max(...state.snapshot.desktops.map((desktop) => desktop.index)) + 1;
                  state.snapshot.desktops.push({
                    index,
                    name: "新しいデスクトップ",
                    current: false,
                  });
                  return;
                }
                case "remove_desktop":
                  state.snapshot.desktops = state.snapshot.desktops.filter(
                    (item) => item.index !== Number(args.index),
                  );
                  return;
                default:
                  state.unsupported.push(command);
                  throw new Error(`未対応のTauriコマンド: ${command}`);
              }
            },
          },
        });
      },
      { snapshot, icons },
    );
    await page.goto("/");
    await expect(page.getByRole("table", { name: "ウィンドウ一覧", exact: true })).toBeVisible();
    await use({
      row: (hwnd) => page.locator(`[data-window-hwnd="${hwnd}"]`),
      ids: () =>
        page
          .locator(".window-row")
          .evaluateAll((rows) =>
            rows.map((row) => Number((row as HTMLElement).dataset.windowHwnd)),
          ),
      selectedIds: () =>
        page
          .locator(".window-row.is-selected")
          .evaluateAll((rows) =>
            rows
              .map((row) => Number((row as HTMLElement).dataset.windowHwnd))
              .sort((a, b) => a - b),
          ),
      calls: () => page.evaluate(() => window.__E2E__.calls),
      refresh: () => page.clock.fastForward(2500),
      setSnapshot: (next) =>
        page.evaluate((next) => {
          window.__E2E__.snapshot = next;
        }, next),
      fail: (command, message) =>
        page.evaluate(
          ({ command, message }) => {
            if (message === null) delete window.__E2E__.failures[command];
            else window.__E2E__.failures[command] = message;
          },
          { command, message },
        ),
      nativeFocus: (focused) =>
        page.evaluate((focused) => window.__E2E__.emitFocus(focused), focused),
      releaseIcon: (hwnd) => page.evaluate((hwnd) => window.__E2E__.releaseIcon(hwnd), hwnd),
    });
    expect(errors, "未処理のブラウザーエラー").toEqual([]);
    expect(await page.evaluate(() => window.__E2E__.unsupported)).toEqual([]);
  },
});

export { expect };
export async function showAllDesktops(page: Page) {
  await page.locator(".filter-desktop button").click();
  await page.getByRole("option", { name: "すべてのデスクトップ", exact: true }).click();
}
