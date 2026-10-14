import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import type {
    pythonCapabilitySchema,
    pythonStatusSchema,
    PythonFunctionDraft,
} from '../../../shared/database/functions/python-functions';
import { message } from '../../api/client';
import { Icon } from '../../ui/components/icons';
import {
    attachPythonFunction,
    publishPythonFunction,
    pythonCapabilities,
    pythonDeploymentStatus,
    pythonManagementSession,
    PythonManagementError,
} from './python-function-api';

export function PythonDeploymentPanel({
    name,
    draft,
    allowed,
    onChanged,
    onBusy,
    onSignature,
}: {
    name: string;
    draft?: PythonFunctionDraft;
    allowed: boolean;
    onChanged: () => void;
    onBusy?: (busy: boolean) => void;
    onSignature?: (arguments_: Array<{ name: string; type: string }>) => void;
}) {
    const [capability, setCapability] = useState<z.infer<typeof pythonCapabilitySchema>>();
    const [status, setStatus] = useState<z.infer<typeof pythonStatusSchema>>();
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [unknown, setUnknown] = useState(false);
    const [selectedService, setSelectedService] = useState('');
    const [selectedVersion, setSelectedVersion] = useState('');
    const [newVersion, setNewVersion] = useState(false);
    const [confirmed, setConfirmed] = useState(false);
    const [revision, setRevision] = useState(0);
    const operationGeneration = useRef(0);
    useEffect(() => {
        const controller = new AbortController();
        if (allowed)
            void pythonCapabilities(controller.signal).then(value => {
                if (!controller.signal.aborted) setCapability(value);
            });
        return () => controller.abort();
    }, [allowed]);
    useEffect(() => {
        setStatus(undefined);
        setUnknown(false);
        setSelectedVersion('');
        setConfirmed(false);
    }, [name]);
    useEffect(() => {
        if (!capability?.serviceId || !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(name)) return;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        const refresh = async () => {
            const generation = operationGeneration.current;
            try {
                const value = await pythonDeploymentStatus(name, controller.signal);
                if (controller.signal.aborted || operationGeneration.current !== generation) return;
                setStatus(value);
                setUnknown(value.operation?.phase === 'unknown');
                setError('');
                if (
                    value.versions.some(version => version.status === 'building') ||
                    value.attachment?.status === 'provisioning'
                )
                    timer = setTimeout(() => void refresh(), 3000);
            } catch (error) {
                if (!controller.signal.aborted) {
                    setError(message(error));
                    if (error instanceof PythonManagementError && error.status === 401)
                        setCapability({ available: true, reason: '' });
                }
            }
        };
        void refresh();
        return () => {
            controller.abort();
            clearTimeout(timer);
        };
    }, [capability?.serviceId, name, revision]);
    const mutate = async (action: () => Promise<unknown>, uncertain = false) => {
        if (busy) return;
        operationGeneration.current++;
        setBusy(true);
        onBusy?.(true);
        setError('');
        try {
            await action();
            setRevision(value => value + 1);
            onChanged();
        } catch (error) {
            setError(message(error));
            if (error instanceof PythonManagementError && error.status === 401)
                setCapability({ available: true, reason: '' });
            if (uncertain) setUnknown(true);
        } finally {
            setBusy(false);
            onBusy?.(false);
        }
    };
    const selected = status?.versions.find(version => String(version.version) === selectedVersion);
    return (
        <section className="python-deployment-panel" aria-label="Cloud deployment">
            <h3>Deployment</h3>
            {!allowed && (
                <p className="sql-function-input-hint">
                    Deployment is unavailable for this connection. ZIP export remains available.
                </p>
            )}
            {allowed && !capability?.available && (
                <p className="sql-function-input-hint">
                    {capability?.reason || 'Checking Cloud management access...'}
                </p>
            )}
            {allowed && capability?.available && !capability.serviceId && (
                <button
                    type="button"
                    className="creation-dialog-button"
                    disabled={busy}
                    onClick={() =>
                        void mutate(async () => setCapability(await pythonManagementSession()))
                    }
                >
                    <Icon name="lock" />
                    Enable deployment session
                </button>
            )}
            {allowed && capability?.serviceId && (
                <>
                    <label className="creation-dialog-field">
                        <span>Target service</span>
                        <select
                            className="creation-dialog-control"
                            aria-label="Target service"
                            value={selectedService}
                            disabled={busy}
                            onChange={event => {
                                setSelectedService(event.target.value);
                                setConfirmed(false);
                            }}
                        >
                            <option value="">Select service</option>
                            <option value={capability.serviceId}>
                                {capability.serviceName} ({capability.serviceId})
                            </option>
                        </select>
                    </label>
                    <div className="python-deployment-actions">
                        <button
                            type="button"
                            className="creation-dialog-button"
                            disabled={busy}
                            onClick={() => setRevision(value => value + 1)}
                        >
                            <Icon name="refresh" />
                            Check Cloud status
                        </button>
                        {draft && (
                            <button
                                type="button"
                                className="creation-dialog-button is-primary"
                                disabled={
                                    busy ||
                                    unknown ||
                                    !status ||
                                    selectedService !== capability.serviceId
                                }
                                onClick={() =>
                                    void mutate(
                                        () => publishPythonFunction(draft, newVersion),
                                        true,
                                    )
                                }
                            >
                                <Icon name="importFile" />
                                {newVersion ? 'Publish new version' : 'Publish function'}
                            </button>
                        )}
                    </div>
                    {draft && (
                        <label className="python-function-checkbox">
                            <input
                                type="checkbox"
                                checked={newVersion}
                                disabled={busy}
                                onChange={event => setNewVersion(event.target.checked)}
                            />
                            Publish a new immutable version of an existing function
                        </label>
                    )}
                    {unknown && (
                        <p className="sql-function-error" role="status">
                            Outcome unknown. Check Cloud status before another deployment attempt.
                        </p>
                    )}
                    {status?.operation && (
                        <p className="sql-function-input-hint">
                            {status.operation.phase}: {status.operation.message}
                        </p>
                    )}
                    {status && (
                        <>
                            <label className="creation-dialog-field">
                                <span>Build version</span>
                                <select
                                    className="creation-dialog-control"
                                    aria-label="Build version"
                                    value={selectedVersion}
                                    disabled={busy}
                                    onChange={event => {
                                        const version = status.versions.find(
                                            version =>
                                                String(version.version) === event.target.value,
                                        );
                                        setSelectedVersion(event.target.value);
                                        setConfirmed(false);
                                        if (version) onSignature?.(version.arguments);
                                    }}
                                >
                                    <option value="">Select version</option>
                                    {status.versions.map(version => (
                                        <option key={version.version} value={version.version}>
                                            v{version.version} - {version.status}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            {selected?.error && (
                                <p className="sql-function-error" role="alert">
                                    {selected.error}
                                </p>
                            )}
                            <p className="sql-function-input-hint">
                                Attached:{' '}
                                {status.attachment
                                    ? `v${status.attachment.version} (${status.attachment.status})`
                                    : 'None'}
                                . Loaded version: unverified.
                            </p>
                            <label className="python-function-checkbox">
                                <input
                                    type="checkbox"
                                    checked={confirmed}
                                    disabled={busy}
                                    onChange={event => setConfirmed(event.target.checked)}
                                />
                                I confirm attachment to {capability.serviceName}. The first UDF
                                attachment causes a rolling restart.
                            </label>
                            <button
                                type="button"
                                className="creation-dialog-button"
                                disabled={
                                    busy ||
                                    unknown ||
                                    !confirmed ||
                                    selected?.status !== 'ready' ||
                                    selectedService !== capability.serviceId
                                }
                                onClick={() =>
                                    void mutate(
                                        () =>
                                            attachPythonFunction(
                                                name,
                                                Number(selectedVersion),
                                                selectedService,
                                            ),
                                        true,
                                    )
                                }
                            >
                                <Icon name="plus" />
                                Attach selected version
                            </button>
                        </>
                    )}
                </>
            )}
            {error && (
                <p className="sql-function-error" role="alert">
                    {error}
                </p>
            )}
        </section>
    );
}
