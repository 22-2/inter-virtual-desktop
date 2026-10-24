import { test, expect, defaultSnapshot, showAllDesktops } from "./fixtures";

test.use({
  snapshot: {
    ...defaultSnapshot,
    windows: Array.from({ length: 45 }, (_, index) => ({
      hwnd: 200 + index,
      title: `資料 ${index} ${"非常に長いウィンドウ名".repeat(12)}`,
      app_name: "Editor",
      desktop_index: index % 2,
      pinned: index % 2 === 0,
      minimized: index % 3 === 0,
    })),
  },
});

for (const viewport of [
  { width: 1120, height: 760 },
  { width: 760, height: 620 },
  { width: 640, height: 520 },
]) {
  test(`${viewport.width}x${viewport.height}で長い名前と45行を表示してもはみ出さない`, async ({
    app: _app,
    page,
  }) => {
    await page.setViewportSize(viewport);
    await showAllDesktops(page);
    await expect(page.locator(".window-row")).toHaveCount(45);
    await page.locator(".window-list").evaluate((list) => {
      list.scrollTop = 400;
    });
    const geometry = await page.evaluate(() => {
      const list = document.querySelector<HTMLElement>(".window-list")!;
      const sidebar = document.querySelector<HTMLElement>(".sidebar")!;
      const main = document.querySelector<HTMLElement>(".main-content")!;
      const header = document.querySelector(".window-table th")!;
      return {
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        listOverflow: list.scrollWidth > list.clientWidth,
        sidebarBottom: Math.round(sidebar.getBoundingClientRect().bottom),
        mainBottom: Math.round(main.getBoundingClientRect().bottom),
        stickyOffset: Math.round(
          header.getBoundingClientRect().top - list.getBoundingClientRect().top,
        ),
        maxRowHeight: Math.max(
          ...Array.from(document.querySelectorAll(".window-row"), (row) =>
            Math.round(row.getBoundingClientRect().height),
          ),
        ),
      };
    });
    expect(geometry.pageOverflow).toBe(false);
    expect(geometry.listOverflow).toBe(false);
    expect(geometry.sidebarBottom).toBe(geometry.mainBottom);
    expect(geometry.stickyOffset).toBe(1);
    expect(geometry.maxRowHeight).toBe(36);
  });
}

test("サイドバーを折りたたんで再展開できる", async ({ app: _app, page }) => {
  const collapse = page.getByRole("button", { name: "サイドバーを折りたたむ", exact: true });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await collapse.click();
  await expect(page.locator(".sidebar")).toBeHidden();

  const expand = page.getByRole("button", { name: "サイドバーを展開", exact: true });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expand.click();
  await expect(page.getByRole("navigation", { name: "仮想デスクトップ" })).toBeVisible();
});
