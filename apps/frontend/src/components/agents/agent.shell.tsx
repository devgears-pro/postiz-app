'use client';

import React, { FC, ReactNode } from 'react';
import { useSelectedLayoutSegment } from 'next/navigation';
import { Agent } from '@gitroom/frontend/components/agents/agent';

export const AgentShell: FC<{ children: ReactNode }> = ({ children }) => {
  const segment = useSelectedLayoutSegment();

  if (segment === 'settings') {
    return <>{children}</>;
  }

  return <Agent>{children}</Agent>;
};
