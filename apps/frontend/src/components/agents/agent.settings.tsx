'use client';

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import type {
  AgentConfigOverrides,
  AgentConfigView,
  SecretChanges,
} from '@gitroom/helpers/agent/agent.config.schema';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import {
  isDirty,
  setPrompt,
  setProvider,
  toWriteRequest,
} from '@gitroom/frontend/components/agents/agent.settings.state';
import { AgentSkillsSettings } from '@gitroom/frontend/components/agents/agent.skills.settings';
import { AgentMcpSettings } from '@gitroom/frontend/components/agents/agent.mcp.settings';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const inputClass =
  'bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[8px] w-full';

const buttonClass =
  'bg-btnSimple text-btnText rounded-[8px] px-[14px] py-[8px] disabled:opacity-40';

const primaryButtonClass =
  'bg-btnPrimary text-white rounded-[8px] px-[16px] py-[10px] disabled:opacity-40';

export const AgentSettings: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const user = useUser();
  const orgId = user?.orgId;

  const load = useCallback(
    async () => (await fetch('/agent-config')).json(),
    []
  );
  const { data: view, error, isLoading, mutate } = useSWR<AgentConfigView>(
    orgId ? ['agent-config', orgId] : null,
    load,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const [overrides, setOverrides] = useState<AgentConfigOverrides>({});
  const [secrets, setSecrets] = useState<SecretChanges>({});
  const [mcpTokens, setMcpTokens] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(
    null
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!view) return;
    setOverrides(view.overrides);
    setSecrets({});
    setMcpTokens({});
    setStatus(null);
  }, [view?.revision, orgId]);

  const promptValue = overrides.systemPrompt ?? view?.defaults.prompt ?? '';
  const promptOverridden = overrides.systemPrompt !== undefined;
  const providerValue =
    overrides.provider?.baseUrl ?? view?.defaults.provider.baseUrl ?? '';
  const providerOverridden = overrides.provider !== undefined;

  const builtinSelected = useMemo(
    () => new Set(overrides.builtinTools ?? view?.effective.builtinTools ?? []),
    [overrides.builtinTools, view?.effective.builtinTools]
  );

  const allowedLangfuse = view?.capabilities.langfuseBaseUrls ?? [];
  const langfuseOverrides = overrides.langfuse ?? {};
  const langfuseEnabled =
    langfuseOverrides.enabled ??
    (overrides.langfuse !== undefined
      ? true
      : view?.effective.langfuse.enabled ?? false);
  const langfuseBaseUrl =
    langfuseOverrides.baseUrl ?? view?.effective.langfuse.baseUrl ?? '';

  if (!user || !['ADMIN', 'SUPERADMIN'].includes(user.role)) {
    return (
      <div className="p-[24px]">{t('agent_settings_admin_only', 'Only organization administrators can change agent settings.')}</div>
    );
  }

  if (isLoading) {
    return <div className="p-[24px]">{t('loading', 'Loading...')}</div>;
  }

  if (error || !view) {
    return (
      <div className="p-[24px]">
        {t('agent_settings_load_error', 'Could not load agent settings.')}
      </div>
    );
  }

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const response = await fetch('/agent-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toWriteRequest(view, overrides, secrets)),
      });
      if (response.status === 409) {
        setStatus({
          kind: 'error',
          text: t(
            'agent_settings_conflict',
            'Someone saved these settings in another tab. Reload to see their version; your unsaved edits are kept here.'
          ),
        });
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setStatus({
          kind: 'error',
          text: body?.message ?? t('agent_settings_save_error', 'Could not save.'),
        });
        return;
      }
      await mutate();
      setStatus({ kind: 'ok', text: t('agent_settings_saved', 'Saved.') });
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const response = await fetch('/agent-config/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: view.revision }),
      });
      if (!response.ok) {
        setStatus({
          kind: 'error',
          text: t('agent_settings_reset_error', 'Could not reset.'),
        });
        return;
      }
      await mutate();
      setStatus({ kind: 'ok', text: t('agent_settings_reset', 'Reset to the shared defaults.') });
    } finally {
      setSaving(false);
    }
  };

  const testProvider = async () => {
    const response = await fetch('/agent-config/test-provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedRevision: view.revision,
        ...(overrides.provider ? { provider: overrides.provider } : {}),
        ...(overrides.model ? { model: overrides.model } : {}),
        ...(secrets.providerApiKey ? { apiKey: secrets.providerApiKey } : {}),
      }),
    });
    const result = await response.json().catch(() => ({}));
    setStatus(
      result.ok
        ? { kind: 'ok', text: t('agent_provider_ok', 'The provider answered.') }
        : {
            kind: 'error',
            text:
              typeof result.reason === 'string'
                ? result.reason
                : t('agent_provider_failed', 'The provider did not answer.'),
          }
    );
  };

  const testMcp = async (id: string, server: any, token?: string) => {
    const response = await fetch('/agent-config/test-mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedRevision: view.revision,
        serverId: id,
        server: {
          url: server.url,
          auth: server.auth,
          ...(server.description ? { description: server.description } : {}),
          ...(server.timeoutMs ? { timeoutMs: server.timeoutMs } : {}),
        },
        ...(token ? { bearerToken: token } : {}),
      }),
    });
    const result = await response.json().catch(() => ({}));
    setStatus(
      result.ok
        ? {
            kind: 'ok',
            text: `${t('agent_mcp_ok', 'Tools found:')} ${result.tools.join(', ') || '-'}`,
          }
        : {
            kind: 'error',
            text:
              (Object.values(result.errors ?? {})[0] as string) ??
              t('agent_mcp_failed', 'The MCP server did not answer.'),
          }
    );
  };

  const dirty = isDirty(view, overrides, secrets) || Object.keys(mcpTokens).length > 0;

  return (
    <div className="flex flex-col gap-[20px] p-[20px] max-w-[900px] w-full overflow-auto">
      <div className="flex items-center gap-[12px] flex-wrap">
        <h1 className="text-[24px] font-[500] flex-1">
          {t('agent_settings_title', 'Agent settings')}
        </h1>
        <span className="text-[12px] opacity-60">
          {t('agent_revision', 'revision')} {view.revision} · {view.defaultsVersion}
        </span>
      </div>

      <p className="text-[14px] opacity-70">
        {t(
          'agent_settings_scope',
          'These settings belong to this organization. Empty fields inherit the shared deployment defaults.'
        )}
      </p>

      {status && (
        <div
          className={`rounded-[8px] p-[12px] text-[14px] ${
            status.kind === 'ok'
              ? 'bg-green-500/10 text-green-500'
              : 'bg-red-500/10 text-red-500'
          }`}
        >
          {status.text}
        </div>
      )}

      <section className="flex flex-col gap-[8px]">
        <div className="flex items-center gap-[8px] flex-wrap">
          <h3 className="text-[18px] font-[500] flex-1">
            {t('agent_prompt_title', 'System prompt')}
          </h3>
          <label className="flex items-center gap-[6px] text-[14px]">
            <input
              type="checkbox"
              checked={promptOverridden}
              onChange={(event) =>
                setOverrides(
                  setPrompt(
                    overrides,
                    event.target.checked ? promptValue : ''
                  )
                )
              }
            />
            {t('agent_override', 'Override')}
          </label>
          <span className="text-[12px] opacity-60">
            {t('agent_source', 'source')}: {view.sources.prompt}
          </span>
        </div>
        <textarea
          rows={14}
          className={inputClass}
          disabled={!promptOverridden}
          value={promptOverridden ? promptValue : view.defaults.prompt}
          onChange={(event) =>
            setOverrides(setPrompt(overrides, event.target.value))
          }
        />
      </section>

      <section className="flex flex-col gap-[8px]">
        <h3 className="text-[18px] font-[500]">
          {t('agent_model_title', 'Model and provider')}
        </h3>
        <label className="text-[14px]">{t('agent_provider_url', 'Provider base URL')}</label>
        <input
          className={inputClass}
          value={providerValue}
          placeholder="https://llm.example.com/v1"
          onChange={(event) =>
            setOverrides(setProvider(overrides, event.target.value))
          }
        />
        <div className="flex items-center gap-[8px] flex-wrap text-[13px] opacity-70">
          <span>
            {providerOverridden
              ? t('agent_provider_own', 'Using your endpoint and key')
              : t('agent_provider_system', 'Using the deployment provider')}
          </span>
          {view.credentials.provider.source === 'organization' && (
            <span>
              {view.credentials.provider.configured
                ? t('agent_key_saved', 'Key saved')
                : t('agent_key_missing', 'Key missing')}
            </span>
          )}
        </div>
        <input
          type="password"
          className={inputClass}
          value={secrets.providerApiKey ?? ''}
          placeholder={
            view.credentials.provider.configured
              ? t('agent_secret_keep', '••••••• saved, leave empty to keep')
              : t('agent_provider_key', 'Provider API key')
          }
          onChange={(event) =>
            setSecrets({ ...secrets, providerApiKey: event.target.value })
          }
        />
        <div className="grid grid-cols-2 gap-[8px]">
          <input
            className={inputClass}
            value={overrides.model ?? ''}
            placeholder={view.defaults.model}
            onChange={(event) =>
              setOverrides({
                ...overrides,
                ...(event.target.value
                  ? { model: event.target.value }
                  : { model: undefined }),
              })
            }
          />
          <input
            className={inputClass}
            value={overrides.titleModel ?? ''}
            placeholder={view.defaults.titleModel}
            onChange={(event) =>
              setOverrides({
                ...overrides,
                ...(event.target.value
                  ? { titleModel: event.target.value }
                  : { titleModel: undefined }),
              })
            }
          />
        </div>
        <div className="flex items-center gap-[8px]">
          <input
            type="number"
            min={1}
            max={50}
            className={`${inputClass} max-w-[180px]`}
            value={overrides.generation?.maxSteps ?? ''}
            placeholder={t('agent_max_steps', 'Max steps')}
            onChange={(event) =>
              setOverrides({
                ...overrides,
                generation: {
                  ...(overrides.generation ?? {}),
                  ...(event.target.value
                    ? { maxSteps: Number(event.target.value) }
                    : { maxSteps: undefined }),
                },
              })
            }
          />
          <button type="button" className={buttonClass} onClick={testProvider}>
            {t('agent_test', 'Test')}
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-[8px]">
        <h3 className="text-[18px] font-[500]">
          {t('agent_tools_title', 'Built-in tools')}
        </h3>
        <div className="flex flex-wrap gap-[12px]">
          {view.capabilities.builtinTools.map((tool) => (
            <label key={tool} className="flex items-center gap-[6px] text-[14px]">
              <input
                type="checkbox"
                checked={builtinSelected.has(tool)}
                onChange={(event) => {
                  const next = new Set(builtinSelected);
                  if (event.target.checked) next.add(tool);
                  else next.delete(tool);
                  setOverrides({
                    ...overrides,
                    builtinTools: [...next].sort(),
                  });
                }}
              />
              {tool}
            </label>
          ))}
        </div>
      </section>

      <AgentSkillsSettings
        view={view}
        overrides={overrides}
        onChange={setOverrides}
      />

      <AgentMcpSettings
        view={view}
        overrides={overrides}
        tokens={mcpTokens}
        onChange={(next) => {
          setOverrides(next);
          if (next.mcpServers) {
            setSecrets({
              ...secrets,
              mcpBearerTokens: Object.fromEntries(
                Object.entries(mcpTokens)
                  .filter(([, value]) => value)
                  .map(([id, value]) => [id, value])
              ),
            });
          }
        }}
        onToken={(id, token) => {
          const next = { ...mcpTokens, [id]: token };
          setMcpTokens(next);
          setSecrets({
            ...secrets,
            mcpBearerTokens: Object.fromEntries(
              Object.entries(next).filter(([, value]) => value)
            ),
          });
        }}
        onTest={testMcp}
      />

      <section className="flex flex-col gap-[8px]">
        <div className="flex items-center gap-[8px] flex-wrap">
          <h3 className="text-[18px] font-[500] flex-1">
            {t('agent_langfuse_title', 'Langfuse tracing')}
          </h3>
          <label className="flex items-center gap-[6px] text-[14px]">
            <input
              type="checkbox"
              checked={langfuseEnabled}
              onChange={(event) =>
                setOverrides({
                  ...overrides,
                  langfuse: {
                    ...(overrides.langfuse ?? {}),
                    enabled: event.target.checked,
                  },
                })
              }
            />
            {t('agent_enabled', 'Enabled')}
          </label>
          <span className="text-[12px] opacity-60">
            {t('agent_source', 'source')}: {view.credentials.langfuse.source}
          </span>
        </div>

        {langfuseEnabled && allowedLangfuse.length > 0 && (
          <select
            className={inputClass}
            value={langfuseOverrides.baseUrl ?? ''}
            onChange={(event) =>
              setOverrides({
                ...overrides,
                langfuse: {
                  ...(overrides.langfuse ?? {}),
                  ...(event.target.value
                    ? { baseUrl: event.target.value }
                    : { baseUrl: undefined }),
                },
              })
            }
          >
            <option value="">
              {t('agent_langfuse_system', 'Deployment default')}
            </option>
            {allowedLangfuse.map((url) => (
              <option key={url} value={url}>
                {url}
              </option>
            ))}
          </select>
        )}

        {langfuseOverrides.baseUrl && (
          <>
            <input
              className={inputClass}
              value={secrets.langfuse?.publicKey ?? ''}
              placeholder={t('agent_langfuse_public', 'Langfuse public key')}
              onChange={(event) =>
                setSecrets({
                  ...secrets,
                  langfuse: {
                    publicKey: event.target.value,
                    secretKey: secrets.langfuse?.secretKey ?? '',
                  },
                })
              }
            />
            <input
              type="password"
              className={inputClass}
              value={secrets.langfuse?.secretKey ?? ''}
              placeholder={t('agent_langfuse_secret', 'Langfuse secret key')}
              onChange={(event) =>
                setSecrets({
                  ...secrets,
                  langfuse: {
                    publicKey: secrets.langfuse?.publicKey ?? '',
                    secretKey: event.target.value,
                  },
                })
              }
            />
          </>
        )}

        <label className="flex items-center gap-[6px] text-[14px]">
          <input
            type="checkbox"
            checked={
              langfuseOverrides.captureContent ??
              view.effective.langfuse.captureContent
            }
            onChange={(event) =>
              setOverrides({
                ...overrides,
                langfuse: {
                  ...(overrides.langfuse ?? {}),
                  captureContent: event.target.checked,
                },
              })
            }
          />
          {t('agent_langfuse_capture', 'Store message text in traces')}
        </label>
      </section>

      <div className="flex items-center gap-[12px] sticky bottom-0 bg-newBgColorInner py-[12px]">
        <button
          type="button"
          className={primaryButtonClass}
          disabled={saving || !dirty}
          onClick={save}
        >
          {t('agent_save', 'Save')}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={saving}
          onClick={reset}
        >
          {t('agent_settings_reset_all', 'Reset all overrides')}
        </button>
      </div>
    </div>
  );
};
