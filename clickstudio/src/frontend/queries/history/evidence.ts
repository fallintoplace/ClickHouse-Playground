/** Compare bound values exactly, independently of object property insertion order. */
export function sameParameters(
    left: Readonly<Record<string, string>>,
    right: Readonly<Record<string, string>>,
): boolean {
    const keys = Object.keys(left);
    return (
        keys.length === Object.keys(right).length &&
        keys.every(key => Object.hasOwn(right, key) && left[key] === right[key])
    );
}
