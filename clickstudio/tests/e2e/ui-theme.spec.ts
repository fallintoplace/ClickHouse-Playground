import { test, expect, type Page } from '@playwright/test';
import { runButton, setAccentForStyles, trust } from './helpers.js';

const themes = [
    {
        value: 'click-dark',
        dark: true,
        surface: '#0c151c',
        panel: '#14232d',
        accent: '#faff69',
        action: '#faff69',
        cyanAccent: '#68e5ff',
        cyanAction: '#68e5ff',
        chrome: '#151515',
        logoColor: 'rgb(255, 255, 255)',
    },
    {
        value: 'click-light',
        dark: false,
        surface: '#f8f8f8',
        panel: '#ffffff',
        accent: '#6b5d00',
        action: '#faff69',
        cyanAccent: '#006c83',
        cyanAction: '#006c83',
        chrome: '#ffffff',
        logoColor: 'rgb(22, 22, 22)',
    },
] as const;

function themeOption(page: Page, value: string) {
    const label = value === 'click-dark' ? 'Dark theme' : 'Light theme';
    return page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: label });
}

for (const theme of themes)
    test(`${theme.value} applies its palette and survives reload`, async ({ page }) => {
        await page.goto('/');
        const option = themeOption(page, theme.value);
        await expect(option).toBeVisible();
        await option.click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme.value);
        await expect(page.locator('html')).toHaveAttribute('data-accent', 'clickhouse-yellow');
        await expect(page.getByRole('group', { name: 'Accent color' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /accent$/ })).toHaveCount(0);

        const palette = await page.locator('html').evaluate(element => {
            const styles = getComputedStyle(element);
            return {
                colorScheme: styles.colorScheme,
                surface: styles.getPropertyValue('--page').trim(),
                panel: styles.getPropertyValue('--panel').trim(),
                accent: styles.getPropertyValue('--accent').trim(),
                action: styles.getPropertyValue('--accent-action').trim(),
            };
        });
        expect(palette.colorScheme).toBe(theme.dark ? 'dark' : 'light');
        expect(palette.surface).toBe(theme.surface);
        expect(palette.panel).toBe(theme.panel);
        expect(palette.accent).toBe(theme.accent);
        expect(palette.action).toBe(theme.action);
        await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
            'content',
            theme.chrome,
        );
        await expect(page.getByRole('img', { name: 'ClickHouse', exact: true })).toHaveCSS(
            'fill',
            theme.logoColor,
        );

        await page.reload();
        await expect(themeOption(page, theme.value)).toBeChecked();
        await expect(page.locator('html')).toHaveAttribute('data-accent', 'clickhouse-yellow');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme.value);
    });

for (const theme of themes)
    test(`${theme.value} retains the cyan palette for future use`, async ({ page }) => {
        await page.goto('/');
        await themeOption(page, theme.value).click();
        await setAccentForStyles(page, 'Cyan accent');
        await expect(page.locator('html')).toHaveAttribute('data-accent', 'cyan');

        const palette = await page.locator('html').evaluate(element => {
            const styles = getComputedStyle(element);
            return {
                accent: styles.getPropertyValue('--accent').trim(),
                action: styles.getPropertyValue('--accent-action').trim(),
            };
        });
        expect(palette.accent).toBe(theme.cyanAccent);
        expect(palette.action).toBe(theme.cyanAction);

        await page.reload();
        await expect(themeOption(page, theme.value)).toBeChecked();
        await expect(page.locator('html')).toHaveAttribute('data-accent', 'clickhouse-yellow');
    });

for (const theme of themes) {
    for (const savedAccent of ['cyan', 'clickhouse-yellow', 'future-accent', ''])
        test(`${theme.value} uses yellow with a saved ${savedAccent || 'empty'} accent`, async ({
            page,
        }) => {
            await page.addInitScript(
                ({ theme, accent }) => {
                    localStorage.setItem('clickstudio:theme', theme);
                    localStorage.setItem('clickstudio:accent', accent);
                },
                { theme: theme.value, accent: savedAccent },
            );
            await page.goto('/');
            await expect(themeOption(page, theme.value)).toBeChecked();
            await expect(page.locator('html')).toHaveAttribute('data-accent', 'clickhouse-yellow');
            await expect(page.locator('.accent-mode-control')).toHaveCount(0);
            for (const mode of ['Standard', 'Experimental']) {
                await page.getByText(mode, { exact: true }).click();
                await expect(page.locator('html')).toHaveAttribute(
                    'data-accent',
                    'clickhouse-yellow',
                );
            }
            await page.reload();
            await expect(page.locator('html')).toHaveAttribute('data-accent', 'clickhouse-yellow');
            expect(await page.evaluate(() => localStorage.getItem('clickstudio:accent'))).toBe(
                savedAccent,
            );
        });

    test(`${theme.value} uses yellow when the accent attribute is absent`, async ({ page }) => {
        await page.goto('/');
        await themeOption(page, theme.value).click();
        const palette = await page.locator('html').evaluate(element => {
            element.removeAttribute('data-accent');
            const styles = getComputedStyle(element);
            return {
                accent: styles.getPropertyValue('--accent').trim(),
                action: styles.getPropertyValue('--accent-action').trim(),
            };
        });
        expect(palette.accent).toBe(theme.accent);
        expect(palette.action).toBe(theme.action);
    });
}

test('yellow works when preference storage is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
        const getItem = Storage.prototype.getItem;
        const setItem = Storage.prototype.setItem;
        const unavailable = (key: string) =>
            key === 'clickstudio:theme' || key === 'clickstudio:accent';
        Storage.prototype.getItem = function (key) {
            if (unavailable(key))
                throw new DOMException('Preference storage is disabled', 'SecurityError');
            return getItem.call(this, key);
        };
        Storage.prototype.setItem = function (key, value) {
            if (unavailable(key))
                throw new DOMException('Preference storage is disabled', 'SecurityError');
            setItem.call(this, key, value);
        };
    });
    await page.goto('/');
    await expect(themeOption(page, 'click-dark')).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'clickhouse-yellow');
    await themeOption(page, 'click-light').click();
    await expect(themeOption(page, 'click-light')).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'clickhouse-yellow');
});

for (const mode of ['Standard', 'Experimental'])
    test(`${mode} keeps light yellow Run flat and readable across interaction states`, async ({
        page,
    }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await trust(page);
        await page.getByText(mode, { exact: true }).click();
        await themeOption(page, 'click-light').click();
        const run = runButton(page);
        await expect(run).toHaveCSS('background-image', 'none');
        await expect(run).toHaveCSS('background-color', 'rgb(250, 255, 105)');
        for (const state of ['normal', 'hover', 'focus']) {
            if (state === 'hover') await run.hover();
            if (state === 'focus') {
                await page.mouse.move(0, 0);
                await page.keyboard.press('Tab');
                await run.focus();
                await expect(run).toHaveCSS('outline-style', 'solid');
            }
            await expect(run).toHaveCSS('background-image', 'none');
            const contrast = await run.evaluate(element => {
                const style = getComputedStyle(element);
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = 1;
                const context = canvas.getContext('2d')!;
                const luminance = (color: string) => {
                    context.fillStyle = color;
                    context.fillRect(0, 0, 1, 1);
                    return [...context.getImageData(0, 0, 1, 1).data]
                        .slice(0, 3)
                        .map(value => {
                            const channel = value / 255;
                            return channel <= 0.04045
                                ? channel / 12.92
                                : ((channel + 0.055) / 1.055) ** 2.4;
                        })
                        .reduce(
                            (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!,
                            0,
                        );
                };
                const text = luminance(style.color);
                const fill = luminance(style.backgroundColor);
                return (Math.max(text, fill) + 0.05) / (Math.min(text, fill) + 0.05);
            });
            expect(contrast, `${mode} ${state} Run text contrast`).toBeGreaterThanOrEqual(7);
        }
        await themeOption(page, 'click-dark').click();
        await expect(run).toHaveCSS('background-image', /linear-gradient/);
        await themeOption(page, 'click-light').click();
        await setAccentForStyles(page, 'Cyan accent');
        await expect(run).toHaveCSS('background-image', 'none');
        await page.reload();
        await expect(run).toHaveCSS('background-image', 'none');
        await expect(run).toHaveCSS('background-color', 'rgb(250, 255, 105)');
    });

test('an unknown saved theme falls back to ClickDark', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('clickstudio:theme', 'future-theme');
        localStorage.setItem('clickstudio:accent', 'future-accent');
    });
    await page.goto('/');
    await expect(themeOption(page, 'click-dark')).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'click-dark');
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'clickhouse-yellow');
});

for (const removedTheme of ['monokai', 'catppuccin-latte'])
    test(`a saved ${removedTheme} preference falls back to ClickDark`, async ({ page }) => {
        await page.addInitScript(
            value => localStorage.setItem('clickstudio:theme', value),
            removedTheme,
        );
        await page.goto('/');
        await expect(themeOption(page, 'click-dark')).toBeChecked();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'click-dark');
    });

test('localized desktop header keeps the theme switch in view', async ({ page }) => {
    await page.setViewportSize({ width: 2048, height: 900 });
    await page.goto('/');

    const topbar = page.locator('.topbar');
    const themeSwitch = page.locator('.theme-mode-control');
    const accentSwitch = page.locator('.accent-mode-control');

    for (const locale of ['en', 'zh']) {
        await page.evaluate(value => localStorage.setItem('clickstudio:locale', value), locale);
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expect(page.locator('.topbar-preferences select')).toHaveCount(0);
        await expect(themeSwitch).toBeVisible();
        await expect(accentSwitch).toHaveCount(0);

        const headerSize = await topbar.evaluate(element => ({
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
        }));
        expect(headerSize.scrollWidth, `${locale} header overflow`).toBeLessThanOrEqual(
            headerSize.clientWidth,
        );

        const themeBounds = await themeSwitch.evaluate(element => {
            const rect = element.getBoundingClientRect();
            return { left: rect.left, right: rect.right, viewportWidth: window.innerWidth };
        });
        expect(themeBounds.left, `${locale} theme switch left edge`).toBeGreaterThanOrEqual(0);
        expect(themeBounds.right, `${locale} theme switch right edge`).toBeLessThanOrEqual(
            themeBounds.viewportWidth,
        );
    }
});
