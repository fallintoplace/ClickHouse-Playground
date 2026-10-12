import { expect, type Locator, type Page } from '@playwright/test';

export async function chooseChartOption(page: Page, control: Locator, value: string) {
    await control.click();
    const escapedValue = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    const option = page.locator(`[role="option"][data-value="${escapedValue}"]`);
    await expect(option).toBeVisible();
    await option.click();
}
