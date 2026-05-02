'use client';

interface CodropsFrameProps {
  demoTitle?: string;
  articleUrl?: string;
  githubUrl?: string;
  hubUrl?: string;
  demos?: Array<{
    label: string;
    href: string;
    current?: boolean;
  }>;
  tags?: string[];
}

export function CodropsFrame(_props: CodropsFrameProps) {
  return null;
}
