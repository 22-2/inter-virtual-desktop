import { test, expect, defaultSnapshot, showAllDesktops } from "./fixtures";

test("検索の結果と空の状態が更新される", async ({ app, page }) => {
  const search = page.getByRole("searchbox", { name: "ウィンドウ名・アプリ名で検索" });
  await search.fill("Editor");
  await expect.poll(() => app.ids()).toEqual([102, 105]);
  await search.fill("該当しない文字列");
  await expect(page.getByText("表示するウィンドウがありません。", { exact: false })).toBeVisible();
  await search.fill("");
  await expect(page.locator(".window-row")).toHaveCount(5);
});

test("アプリ・デスクトップ・最小化を組み合わせて絞り込める", async ({ app, page }) => {
  await page.locator(".filter-app button").click();
  await page.getByRole("option", { name: "Editor", exact: true }).click();
  await expect.poll(() => app.ids()).toEqual([102, 105]);
  await page.getByText("最小化を除く", { exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "最小化を除く" })).toBeChecked();
  await expect.poll(() => app.ids()).toEqual([105]);
  await page.getByText("最小化を除く", { exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "最小化を除く" })).not.toBeChecked();
  await page.locator(".filter-app button").click();
  await page.getByRole("option", { name: "すべてのアプリ", exact: true }).click();
  await showAllDesktops(page);
  await expect(page.locator(".window-row")).toHaveCount(6);
  await expect(app.row(106)).toBeVisible();
});

test("列見出しで昇順・降順に並べ替えられる", async ({ app, page }) => {
  await page.getByRole("button", { name: "ウィンドウで降順に並べ替え", exact: true }).click();
  await expect.poll(() => app.ids()).toEqual([104, 101, 102, 105, 103]);
  await expect(page.locator('th[aria-sort="descending"]')).toHaveCount(1);
  await page.getByRole("button", { name: "アプリで昇順に並べ替え", exact: true }).click();
  await expect.poll(() => app.ids()).toEqual([103, 104, 102, 105, 101]);
  await showAllDesktops(page);
  await page.getByRole("button", { name: "デスクトップで昇順に並べ替え", exact: true }).click();
  await expect.poll(() => app.ids()).toEqual([101, 102, 103, 104, 105, 106]);
  await page.getByRole("button", { name: "デスクトップで降順に並べ替え", exact: true }).click();
  await expect.poll(() => app.ids()).toEqual([106, 101, 102, 103, 104, 105]);
  await page.getByRole("button", { name: "状態で昇順に並べ替え", exact: true }).click();
  await expect.poll(() => app.ids()).toEqual([101, 105, 106, 103, 102, 104]);
});

test("定期更新時の列挙順が変わっても表示順を維持する", async ({ app }) => {
  await app.setSnapshot({ ...defaultSnapshot, windows: [...defaultSnapshot.windows].reverse() });
  await app.refresh();
  await expect.poll(() => app.ids()).toEqual([103, 102, 105, 101, 104]);
});

test("同じソートキーのウィンドウも更新後にHWND順を維持する", async ({ app }) => {
  const windows = [300, 100, 200].map((hwnd) => ({
    ...defaultSnapshot.windows[0],
    hwnd,
    title: "同じタイトル",
    app_name: "同じアプリ",
  }));
  const snapshot = { ...defaultSnapshot, windows };

  await app.setSnapshot(snapshot);
  await app.refresh();
  await expect.poll(() => app.ids()).toEqual([100, 200, 300]);

  await app.setSnapshot({ ...snapshot, windows: [...windows].reverse() });
  await app.refresh();
  await expect.poll(() => app.ids()).toEqual([100, 200, 300]);
});

test("表示順を使ったShift選択とCtrl選択・全選択・解除ができる", async ({ app, page }) => {
  await app.row(103).locator(".window-title").click();
  await app
    .row(105)
    .locator(".window-title")
    .click({ modifiers: ["Shift"] });
  await expect.poll(() => app.selectedIds()).toEqual([102, 103, 105]);
  await app
    .row(101)
    .locator(".window-title")
    .click({ modifiers: ["Control"] });
  await expect.poll(() => app.selectedIds()).toEqual([101, 102, 103, 105]);
  await page.getByRole("button", { name: "アプリで昇順に並べ替え", exact: true }).click();
  await expect.poll(() => app.selectedIds()).toEqual([101, 102, 103, 105]);
  await app.row(101).locator(".window-title").focus();
  await page.keyboard.press("Control+a");
  await expect.poll(() => app.selectedIds()).toEqual([101, 102, 103, 104, 105]);
  await page.keyboard.press("Escape");
  await expect.poll(() => app.selectedIds()).toEqual([]);
});

test("選択した複数ウィンドウをサブメニューから一括移動できる", async ({ app, page }) => {
  await app.row(101).locator(".window-title").click();
  await app
    .row(103)
    .locator(".window-title")
    .click({ modifiers: ["Control"] });
  await app.row(103).locator(".window-title").click({ button: "right" });
  await page.getByRole("menuitem", { name: "選択した2件の移動先", exact: true }).click();
  await page
    .getByRole("menuitem", { name: `${defaultSnapshot.desktops[1].name}へ移動`, exact: true })
    .click();
  await expect
    .poll(() => app.calls())
    .toEqual([
      { command: "move_window", args: { hwnd: 103, desktopIndex: 1 } },
      { command: "move_window", args: { hwnd: 101, desktopIndex: 1 } },
    ]);
  await expect(app.row(101)).toHaveCount(0);
  await expect(app.row(103)).toHaveCount(0);
  await expect.poll(() => app.selectedIds()).toEqual([]);
});

test("選択中のうち現在デスクトップ上でないウィンドウだけを移動する", async ({ app, page }) => {
  await showAllDesktops(page);
  await app.row(101).locator(".window-title").click();
  await app.row(106).locator(".window-title").click({ modifiers: ["Control"] });
  await app.row(106).locator(".window-title").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "選択した2件を現在のデスクトップへ移動", exact: true })
    .click();

  await expect.poll(() => app.calls()).toEqual([
    { command: "move_window", args: { hwnd: 106, desktopIndex: 0 } },
  ]);
  await expect(app.row(106).locator(".window-desktop")).toHaveText("メイン");

  await app.row(101).locator(".window-title").click({ button: "right" });
  await expect(
    page.getByRole("menuitem", {
      name: "選択した2件を現在のデスクトップへ移動",
      exact: true,
    }),
  ).toBeDisabled();
  await expect.poll(() => app.calls()).toHaveLength(1);
});

test("ウィンドウをデスクトップにドラッグして移動できる", async ({ app, page }) => {
  await app.row(101).dragTo(page.locator('[data-desktop-index="1"]'));
  await expect
    .poll(() => app.calls())
    .toContainEqual({
      command: "move_window",
      args: { hwnd: 101, desktopIndex: 1 },
    });
  await expect(app.row(101)).toHaveCount(0);
});

test("ダークモードをページ再読み込み後も維持する", async ({ app: _app, page }) => {
  await page.getByRole("button", { name: "ダークモードに切り替え", exact: true }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "ライトモードに切り替え", exact: true }),
  ).toBeVisible();
});

test("APIエラーを表示し、再試行で復旧できる", async ({ app, page }) => {
  await app.fail("get_snapshot", "API接続失敗のテスト");
  await app.refresh();
  await expect(
    page.getByText("仮想デスクトップAPIに接続できません", { exact: true }),
  ).toBeVisible();
  await app.fail("get_snapshot", null);
  await page.getByRole("button", { name: "再試行", exact: true }).click();
  await expect(page.getByRole("table", { name: "ウィンドウ一覧", exact: true })).toBeVisible();
});
