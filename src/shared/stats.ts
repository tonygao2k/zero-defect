export type HomeStats = {
  /** 当前学期已确认的错题数,以及涉及的知识点数。 */
  mistakeCount: number;
  knowledgePointCount: number;
  /** 累计有效的独立答对或答错次数。 */
  answeredCount: number;
  masteredKnowledgePoints: number;
  remainingKnowledgePoints: number;
  practiceablePairs: number;
  dailyPractice: {
    date: string;
    canResume: boolean;
    submitted: boolean;
    dueReviews: number;
    overdueReviews: number;
    plan: {
      review: number;
      recheck: number;
      reinforcement: number;
    };
  };
  unsureRecheckPending: number;
  guidedRecheck: {
    pending: number;
    completed: number;
    correct: number;
  };
  crossDayRecheck: {
    waiting: number;
    due: number;
    completed: number;
    correct: number;
  };
};
