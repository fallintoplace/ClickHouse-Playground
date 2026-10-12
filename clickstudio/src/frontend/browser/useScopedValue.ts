import { useCallback, useRef, useState } from 'react';

export function useScopedValue<T>(key: string | undefined) {
    const keyRef = useRef(key);
    keyRef.current = key;
    const [scoped, setScoped] = useState<Record<string, T>>({});
    const value = key === undefined ? undefined : scoped[key];
    const setForKey = useCallback((target: string, next: T, allowInactive = false) => {
        setScoped(current => {
            if (!allowInactive && keyRef.current !== target) return current;
            return { ...current, [target]: next };
        });
    }, []);
    const updateForKey = useCallback(
        (target: string, update: (current: T | undefined) => T, allowInactive = false) => {
            setScoped(current => {
                if (!allowInactive && keyRef.current !== target) return current;
                return { ...current, [target]: update(current[target]) };
            });
        },
        [],
    );
    return [value, setForKey, scoped, updateForKey] as const;
}
