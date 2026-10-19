import stylelint from 'stylelint';

const focusOwner = 'clickstudio/focus-owner';

export default {
    plugins: [
        stylelint.createPlugin(focusOwner, () => (root, result) => {
            if (root.source?.input.file?.endsWith('/base/focus.css')) return;
            root.walkRules(rule => {
                const selector = rule.selector.replace(/:not\([^)]*\)/g, '');
                if (!/:focus(?:-visible|-within)?\b/.test(selector)) return;
                stylelint.utils.report({
                    message: 'Put focus states in base/focus.css.',
                    node: rule,
                    result,
                    ruleName: focusOwner,
                });
            });
        }),
    ],
    rules: {
        [focusOwner]: true,
        'at-rule-no-unknown': [true, { ignoreAtRules: ['theme'] }],
        'block-no-empty': true,
        'color-no-invalid-hex': true,
        'declaration-block-no-duplicate-properties': [
            true,
            { ignore: ['consecutive-duplicates-with-different-values'] },
        ],
        'declaration-no-important': true,
        'declaration-property-value-disallowed-list': {
            'font-size': [/\d*\.?\d+px\b/],
        },
        'declaration-property-value-no-unknown': true,
        'function-no-unknown': true,
        'no-duplicate-selectors': true,
        'property-no-unknown': true,
        'selector-pseudo-class-no-unknown': true,
        'selector-pseudo-element-no-unknown': true,
        'unit-no-unknown': true,
    },
};
