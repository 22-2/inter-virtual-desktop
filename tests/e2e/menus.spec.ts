import { test, expect, defaultSnapshot } from "./fixtures";

test("メニューの外側クリックでメニューと選択を解除する", async ({ app, page }) => {
  await app.row(101).locator(".window-title").click({ button: "right" });
  await expect(page.getByRole("menu", { name: "ウィンドウの操作", exact: true })).toBeVisible();
  await page.getByRole("heading", { name: "メイン", exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect.poll(() => app.selectedIds()).toEqual([]);
});

test("一覧の空白をクリックして選択を解除する", async ({ app, page }) => {
  await app.row(101).locator(".window-title").click();
  const list = page.locator(".window-list");
  const box = await list.boundingBox();
  await list.click({ position: { x: 20, y: box!.height - 16 } });
  await expect.poll(() => app.selectedIds()).toEqual([]);
});

test("Tauriのフォーカス喪失イベントでメニューと選択を解除する", async ({ app, page }) => {
  await app.row(101).locator(".window-title").click({ button: "right" });
  expect(await app.nativeFocus(false)).toBe(1);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect.poll(() => app.selectedIds()).toEqual([]);
});

test("ドキュメントでイベント伝播が止まっても外側クリックを捕捉する", async ({ app, page }) => {
  await app.row(101).locator(".window-title").click({ button: "right" });
  await page.evaluate(() =>
    document.addEventListener("pointerdown", (event) => event.stopPropagation(), {
      capture: true,
      once: true,
    }),
  );
  await page.getByRole("heading", { name: "メイン", exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect.poll(() => app.selectedIds()).toEqual([]);
});

test("メニュー上で再度右クリックしてもアプリのメニューを開く", async ({ app, page }) => {
  await app.row(101).locator(".window-title").click({ button: "right" });
  await page
    .getByRole("menu", { name: "ウィンドウの操作", exact: true })
    .click({ button: "right", position: { x: 12, y: 12 } });
  await expect(page.getByRole("menu")).toHaveCount(1);
  await expect(
    page.getByRole("menuitem", { name: "フォーカスして前面に表示", exact: true }),
  ).toBeVisible();
  expect(await app.calls()).toEqual([]);
});

test.describe("画面端のサブメニュー", () => {
  test.use({
    snapshot: {
      ...defaultSnapshot,
      desktops: Array.from({ length: 30 }, (_, index) => ({
        index,
        name: index === 0 ? "メイン" : `🥺調べものの非常に長いデスクトップ名 ${index}`,
        current: index === 0,
      })),
    },
  });
  for (const viewport of [
    { width: 1120, height: 760 },
    { width: 674, height: 560 },
  ]) {
    for (const corner of ["左上", "右上", "左下", "右下"] as const) {
      test(`${viewport.width}px・${corner}でもメニューが潰れず画面に収まる`, async ({
        app,
        page,
      }) => {
        await page.setViewportSize(viewport);
        await app.row(101).locator(".window-title").click({ button: "right" });
        const x = corner.includes("右") ? viewport.width - 8 : 8;
        const y = corner.includes("下") ? viewport.height - 8 : 8;
        await page.mouse.click(x, y, { button: "right" });
        await page.getByRole("menuitem", { name: "移動先を選択", exact: true }).click();
        await expect(page.locator('[role="menu"][aria-label="移動先"]')).toBeVisible();
        await expect
          .poll(() =>
            page.locator("[data-rac][data-placement]").evaluateAll((nodes) =>
              nodes.every((node) => {
                const rect = node.getBoundingClientRect();
                return (
                  rect.x >= 0 &&
                  rect.y >= 0 &&
                  rect.right <= innerWidth + 1 &&
                  rect.bottom <= innerHeight + 1
                );
              }),
            ),
          )
          .toBe(true);
        await expect(page.locator('[data-trigger="SubmenuTrigger"]')).toHaveCSS("width", "240px");
        const label = await page.locator(".context-menu-label").first().boundingBox();
        expect(label!.height).toBeLessThan(30);
      });
    }
  }
});
