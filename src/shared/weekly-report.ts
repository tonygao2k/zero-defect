import type { Figure } from './figure';

export type WeeklyRecord = {
  id: string;
  date: string;
  kind: 'mistake' | 'correct' | 'wrong' | 'unsure' | 'hint' | 'assisted';
  questionMarkdown: string;
  figure: Figure | null;
  options: string[];
  submittedAnswer: string;
  correctAnswer: string;
  unit: string;
  hintDate: string | null;
};

export type WeeklyTopic = {
  point: string;
  cause: string;
  independentCount: number;
  independentCorrect: number;
  mistakeCount: number;
  hintCount: number;
  unsureCount: number;
  recheckCount: number;
  next: {
    kind: 'recheck' | 'recheck_later' | 'retry' | 'reinforce' | 'review';
    date: string | null;
  } | null;
  records: WeeklyRecord[];
};

export type WeeklyReport = {
  start: string;
  end: string;
  isCurrent: boolean;
  previousStart: string | null;
  nextStart: string | null;
  independentCount: number;
  independentCorrect: number;
  recheckCount: number;
  topics: WeeklyTopic[];
  duePractice: { point: string; cause: string; recheck: boolean }[];
};
