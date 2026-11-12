export type HomeStats = {
  /** 当前学期已确认的错题数,以及涉及的知识点数。 */
  mistakeCount: number;
  knowledgePointCount: number;
  /** 累计作答的练习题数(不含跳过的)。 */
  answeredCount: number;
  masteredKnowledgePoints: number;
  remainingKnowledgePoints: number;
  /** 现在能练习的“知识点 + 根因”数(未掌握的,或已掌握且该复习的)。为 0 时“开始练习”置灰。 */
  practiceablePairs: number;
};
