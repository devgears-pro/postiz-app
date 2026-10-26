'use client';

import React, { FC } from 'react';
import type {
  AgentConfigView,
  McpServerDefinition,
} from '@gitroom/helpers/agent/agent.config.schema';
import {
  formMcpServers,
  removeMcpServer,
  upsertMcpServer,
} from '@gitroom/frontend/components/agents/agent.settings.state';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const EMPTY_SERVER: McpServerDefinition = {
  url: '',
  auth: 'bearer',
  enabledTools: [],
};

export const AgentMcpSettings: FC<{
  view: AgentConfigView;
  overrides: any;
  tokens: Record<string, string>;
  onChange: (overrides: any) => void;
  onToken: (id: string, token: string) => void;
  onTest: (id: string, server: McpServerDefinition, token?: string) => void;
}> = ({ view, overrides, tokens, onChange, onToken, onTest }) => {
  const t = useT();
  const servers = formMcpServers({ ...view, overrides });

  return (
    <section className="flex flex-col gap-[12px]">
      <header>
        <h3 className="text-[18px] font-[500]">
          {t('agent_mcp_title', 'MCP servers')}
        </h3>
        <p className="text-[14px] opacity-70">
          {t(
            'agent_mcp_hint',
            'Postiz exposes these tools to the agent. Only the tools you select are sent.'
          )}
        </p>
      </header>

      {servers.map((server) => {
        const disabled = overrides.mcpServers?.[server.id] === null;
        const credential = view.credentials.mcp[server.id];
        return (
          <div
            key={server.id}
            className="flex flex-col gap-[8px] border border-newTableBorder rounded-[8px] p-[12px]"
          >
            <div className="flex items-center gap-[8px] flex-wrap">
              <strong className="flex-1">{server.id}</strong>
              <span className="text-[12px] opacity-60">
                {server.inherited
                  ? t('agent_inherited', 'shared')
                  : t('agent_local', 'organization')}
              </span>
              <label className="flex items-center gap-[6px] text-[14px]">
                <input
                  type="checkbox"
                  checked={!disabled}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? removeMcpServer(view, overrides, server.id)
                        : {
                            ...overrides,
                            mcpServers: {
                              ...(overrides.mcpServers ?? {}),
                              [server.id]: null,
                            },
                          }
                    )
                  }
                />
                {t('agent_enabled', 'Enabled')}
              </label>
            </div>

            {!server.inherited && (
              <input
                className="bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[8px]"
                value={server.url}
                placeholder="https://mcp.example.com/mcp"
                onChange={(event) =>
                  onChange(
                    upsertMcpServer(overrides, server.id, {
                      ...server,
                      url: event.target.value,
                    })
                  )
                }
              />
            )}

            <div className="flex gap-[8px] flex-wrap">
              <input
                className="flex-1 min-w-[240px] bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[8px]"
                value={server.enabledTools.join(', ')}
                placeholder={t('agent_mcp_tools', 'findCustomer, createLead')}
                onChange={(event) =>
                  onChange(
                    upsertMcpServer(overrides, server.id, {
                      ...server,
                      enabledTools: event.target.value
                        .split(',')
                        .map((tool) => tool.trim())
                        .filter(Boolean),
                    })
                  )
                }
              />
              {server.auth === 'bearer' && (
                <input
                  type="password"
                  className="flex-1 min-w-[200px] bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[8px]"
                  value={tokens[server.id] ?? ''}
                  placeholder={
                    credential?.configured
                      ? t('agent_secret_keep', '••••••• saved, leave empty to keep')
                      : t('agent_mcp_token', 'Bearer token')
                  }
                  onChange={(event) => onToken(server.id, event.target.value)}
                />
              )}
              <button
                type="button"
                className="bg-btnSimple text-btnText rounded-[8px] px-[14px] py-[8px]"
                onClick={() => onTest(server.id, server, tokens[server.id])}
              >
                {t('agent_test', 'Test')}
              </button>
              {!server.inherited && (
                <button
                  type="button"
                  className="bg-btnSimple text-btnText rounded-[8px] px-[14px] py-[8px]"
                  onClick={() => onChange(removeMcpServer(view, overrides, server.id))}
                >
                  {t('agent_remove', 'Remove')}
                </button>
              )}
            </div>
          </div>
        );
      })}

      <button
        type="button"
        className="self-start bg-btnSimple text-btnText rounded-[8px] px-[14px] py-[8px]"
        onClick={() => {
          const id = window.prompt(
            t('agent_mcp_id', 'Server id (lowercase, hyphens)')
          );
          if (!id) return;
          onChange(
            upsertMcpServer(overrides, id, {
              ...EMPTY_SERVER,
              url: 'https://',
              enabledTools: [],
            })
          );
        }}
      >
        {t('agent_mcp_add', 'Add MCP server')}
      </button>
    </section>
  );
};
