import { test, expect } from "./fixtures";

test("ダブルクリックで対象ウィンドウのフォーカスコマンドを呼ぶ", async ({ app }) => {
  await app.row(101).locator(".window-title").dblclick();
  await expect.poll(() => app.calls()).toEqual([{ command: "focus_window", args: { hwnd: 101 } }]);
});

test("複数選択時も右クリックした対象だけをフォーカスする", async ({ app, page }) => {
  await app.row(101).locator(".window-title").click();
  await app
    .row(103)
    .locator(".window-title")
    .click({ modifiers: ["Control"] });
  await app.row(101).locator(".window-title").click({ button: "right" });
  await page.getByRole("menuitem", { name: "フォーカスして前面に表示", exact: true }).click();
  await expect.poll(() => app.calls()).toEqual([{ command: "focus_window", args: { hwnd: 101 } }]);
});

test("操作ボタンのダブルクリックではフォーカスしない", async ({ app }) => {
  await app.row(101).locator(".window-actions-cell button").dblclick();
  expect(await app.calls()).toEqual([]);
});

test.describe("アプリアイコン", () => {
  test.use({
    icons: { 101: "valid", 102: "missing", 103: "invalid", 104: "error", 105: "pending" },
  });

  test("取得不可・壊れた画像・取得失敗・読み込み中は頭文字を表示する", async ({ app }) => {
    await expect(app.row(101).locator("img")).toBeVisible();
    await expect(app.row(102).locator(".app-icon")).toHaveText("E");
    await expect(app.row(103).locator(".app-icon")).toHaveText("A");
    await expect(app.row(104).locator(".app-icon")).toHaveText("B");
    await expect(app.row(105).locator(".app-icon")).toHaveText("E");
    await app.releaseIcon(105);
    await expect(app.row(105).locator("img")).toBeVisible();
  });

  test("アイコンは背景付きの20pxタイル内で16pxに収まる", async ({ app, page }) => {
    const tile = app.row(101).locator(".app-icon");
    await expect(tile.locator("img")).toHaveCSS("width", "16px");
    await expect(tile).toHaveCSS("width", "20px");
    for (const dark of [false, true]) {
      if (dark)
        await page.getByRole("button", { name: "ダークモードに切り替え", exact: true }).click();
      const background = await tile.evaluate((node) => getComputedStyle(node).backgroundColor);
      expect(background).not.toBe("rgba(0, 0, 0, 0)");
      await expect(app.row(102).locator(".app-icon")).toHaveCSS("background-color", background);
    }
  });
});
