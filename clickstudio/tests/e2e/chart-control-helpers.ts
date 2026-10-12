import { expect, type Locator, type Page } from '@playwright/test';

export async function chooseChartOption(page: Page, control: Locator, value: string) {
    await control.click();
    const escapedValue = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    const listboxId = await control.getAttribute('aria-controls');
    if (!listboxId) throw new Error('Chart selector does not expose its option list.');
    const listbox = page.locator(`[id="${listboxId}"]`);
    const option = listbox.locator(`[role="option"][data-value="${escapedValue}"]`);
    await expect(option).toBeVisible();
    await option.click();
}
