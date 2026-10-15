import { useEffect, useMemo, useState } from 'react';
import type { GeoFeature } from './geo';
import {
    basemapFeatures,
    basemapForFeatures,
    WORLD_BASEMAP,
    type BasemapFeature,
    type GeoBasemap,
} from './geo-basemap';

export function useGeoBasemap(features: GeoFeature[]) {
    const requested = useMemo(() => basemapForFeatures(features), [features]);
    const [loaded, setLoaded] = useState<{
        requested: GeoBasemap['id'];
        config: GeoBasemap;
        features: BasemapFeature[];
    }>();
    useEffect(() => {
        const controller = new AbortController();
        const load = async () => {
            for (const config of requested.id === 'world'
                ? [requested]
                : [requested, WORLD_BASEMAP]) {
                try {
                    const response = await fetch(`${import.meta.env.BASE_URL}geo/${config.file}`, {
                        signal: controller.signal,
                    });
                    if (!response.ok) continue;
                    const features = basemapFeatures(await response.json());
                    if (!features.length || controller.signal.aborted) continue;
                    setLoaded({ requested: requested.id, config, features });
                    return;
                } catch {
                    if (controller.signal.aborted) return;
                }
            }
        };
        void load();
        return () => controller.abort();
    }, [requested]);
    return loaded?.requested === requested.id ? loaded : { config: requested, features: [] };
}
