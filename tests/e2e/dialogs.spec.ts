import { test, expect } from "./fixtures";

test("名前変更の入力欄と保存ボタンが重複せず、一度だけ保存する", async ({ app, page }) => {
  await page.locator('[data-desktop-index="1"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "名前を変更", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  const field = page.getByRole("textbox", { name: "デスクトップ名", exact: true });
  const save = page.getByRole("button", { name: "保存", exact: true });
  await expect(field).toHaveCount(1);
  await expect(save).toHaveCount(1);
  await field.fill("作業");
  await save.click();
  await expect
    .poll(() => app.calls())
    .toEqual([{ command: "rename_desktop", args: { index: 1, name: "作業" } }]);
  await expect(page.locator('[data-desktop-index="1"] .desktop-select')).toContainText("作業");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

for (const area of [".sidebar", ".main-content"]) {
  test(`${area}から追加ダイアログを開いてデスクトップを作成する`, async ({ app, page }) => {
    await page
      .locator(area)
      .getByRole("button", { name: "デスクトップを追加", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    const create = page.getByRole("button", { name: "作成", exact: true });
    await expect(create).toHaveCount(1);
    await create.click();
    await expect.poll(() => app.calls()).toEqual([{ command: "create_desktop", args: {} }]);
    await expect(page.locator(".desktop-entry")).toHaveCount(3);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}
