import { test, expect } from "./fixtures";

test("一覧が起動し、数値を含むウィンドウ名が自然順で並ぶ", async ({ app, page }) => {
  await expect(page.getByRole("heading", { name: "メイン", exact: true })).toBeVisible();
  await expect.poll(() => app.ids()).toEqual([103, 102, 105, 101, 104]);
});
