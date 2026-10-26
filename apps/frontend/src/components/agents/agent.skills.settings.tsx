'use client';

import React, { FC, useState } from 'react';
import type {
  AgentConfigOverrides,
  AgentConfigView,
  SkillDefinition,
} from '@gitroom/helpers/agent/agent.config.schema';
import {
  formSkills,
  removeSkill,
  setSkillEnabled,
  upsertSkill,
} from '@gitroom/frontend/components/agents/agent.settings.state';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const AgentSkillsSettings: FC<{
  view: AgentConfigView;
  overrides: AgentConfigOverrides;
  onChange: (overrides: AgentConfigOverrides) => void;
}> = ({ view, overrides, onChange }) => {
  const t = useT();
  const [editing, setEditing] = useState<SkillDefinition | null>(null);
  const skills = formSkills({ ...view, overrides });

  return (
    <section className="flex flex-col gap-[12px]">
      <header>
        <h3 className="text-[18px] font-[500]">
          {t('agent_skills_title', 'Skills')}
        </h3>
        <p className="text-[14px] opacity-70">
          {t(
            'agent_skills_hint',
            'The agent loads a skill only when it needs it. Skills are instructions, not executable code.'
          )}
        </p>
      </header>

      {skills.map((skill) => (
        <div
          key={skill.name}
          className="flex flex-col gap-[6px] border border-newTableBorder rounded-[8px] p-[12px]"
        >
          <div className="flex items-center gap-[8px] flex-wrap">
            <strong className="flex-1">{skill.name}</strong>
            <span className="text-[12px] opacity-60">
              {skill.inherited
                ? t('agent_inherited', 'shared')
                : t('agent_local', 'organization')}
            </span>
            {skill.inherited ? (
              <label className="flex items-center gap-[6px] text-[14px]">
                <input
                  type="checkbox"
                  checked={skill.enabled}
                  onChange={(event) =>
                    onChange(
                      setSkillEnabled(
                        view,
                        overrides,
                        skill.name,
                        event.target.checked
                      )
                    )
                  }
                />
                {t('agent_enabled', 'Enabled')}
              </label>
            ) : (
              <button
                type="button"
                className="text-[14px] underline"
                onClick={() => onChange(removeSkill(view, overrides, skill.name))}
              >
                {t('agent_remove', 'Remove')}
              </button>
            )}
          </div>
          <p className="text-[14px] opacity-80">{skill.description}</p>
        </div>
      ))}

      {editing ? (
        <SkillEditor
          value={editing}
          onCancel={() => setEditing(null)}
          onSave={(skill) => {
            onChange(upsertSkill(overrides, skill));
            setEditing(null);
          }}
        />
      ) : (
        <button
          type="button"
          className="self-start bg-btnSimple text-btnText rounded-[8px] px-[14px] py-[8px]"
          onClick={() =>
            setEditing({
              name: '',
              description: '',
              instructions: '',
            })
          }
        >
          {t('agent_skill_add', 'Add skill')}
        </button>
      )}
    </section>
  );
};

const SkillEditor: FC<{
  value: SkillDefinition;
  onSave: (skill: SkillDefinition) => void;
  onCancel: () => void;
}> = ({ value, onSave, onCancel }) => {
  const t = useT();
  const [skill, setSkill] = useState(value);
  const valid =
    /^[a-z0-9][a-z0-9-]{0,63}$/.test(skill.name) &&
    skill.description.trim().length > 0 &&
    skill.instructions.trim().length > 0;

  return (
    <div className="flex flex-col gap-[8px] border border-newTableBorder rounded-[8px] p-[12px]">
      <input
        className="bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[8px]"
        placeholder={t('agent_skill_name', 'Name, lowercase with hyphens')}
        value={skill.name}
        onChange={(event) => setSkill({ ...skill, name: event.target.value })}
      />
      <input
        className="bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[8px]"
        placeholder={t('agent_skill_description', 'When should the agent use it?')}
        value={skill.description}
        onChange={(event) =>
          setSkill({ ...skill, description: event.target.value })
        }
      />
      <textarea
        rows={8}
        className="bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[8px]"
        placeholder={t('agent_skill_instructions', 'Skill instructions (Markdown)')}
        value={skill.instructions}
        onChange={(event) =>
          setSkill({ ...skill, instructions: event.target.value })
        }
      />
      <div className="flex gap-[8px]">
        <button
          type="button"
          disabled={!valid}
          className="bg-btnPrimary text-white rounded-[8px] px-[14px] py-[8px] disabled:opacity-40"
          onClick={() => onSave(skill)}
        >
          {t('agent_save', 'Save')}
        </button>
        <button
          type="button"
          className="bg-btnSimple text-btnText rounded-[8px] px-[14px] py-[8px]"
          onClick={onCancel}
        >
          {t('agent_cancel', 'Cancel')}
        </button>
      </div>
    </div>
  );
};
