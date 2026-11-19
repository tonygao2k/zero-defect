ALTER TABLE answer_attempts ADD COLUMN outcome TEXT NOT NULL DEFAULT 'unknown'
  CHECK (outcome IN ('correct','wrong','unsure','skipped','unknown'));

UPDATE answer_attempts AS a
SET outcome = CASE
  WHEN a.skipped=1 THEN 'skipped'
  WHEN TRIM(a.submitted_answer)<>'' AND a.used_hint=0 AND a.is_correct IN (0,1)
    AND julianday(a.created_at) IS NOT NULL
    AND a.rowid=(SELECT first.rowid FROM answer_attempts first
                 WHERE first.practice_question_id=a.practice_question_id
                 ORDER BY first.created_at,first.rowid LIMIT 1)
    THEN CASE WHEN a.is_correct=1 THEN 'correct' ELSE 'wrong' END
  ELSE 'unknown'
END;

ALTER TABLE mistakes ADD COLUMN confirmed_evidence_at TEXT;

CREATE TABLE practice_question_review_events (
  sequence INTEGER PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES practice_questions(id),
  action TEXT NOT NULL CHECK (action IN ('report','keep','void','restore')),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_practice_review_question ON practice_question_review_events(question_id,sequence);

CREATE VIEW practice_question_review_state AS
SELECT e.question_id,e.action,e.reason,e.created_at
FROM practice_question_review_events e
WHERE e.sequence=(SELECT MAX(latest.sequence) FROM practice_question_review_events latest
                   WHERE latest.question_id=e.question_id);

CREATE VIEW valid_practice_questions AS
SELECT q.*,q.rowid question_order FROM practice_questions q
LEFT JOIN practice_question_review_state review ON review.question_id=q.id
WHERE q.status<>'discarded' AND COALESCE(review.action,'')<>'void';

CREATE VIEW practice_first_answers AS
SELECT a.*,a.rowid attempt_order,q.session_id FROM answer_attempts a
JOIN valid_practice_questions q ON q.id=a.practice_question_id
WHERE a.rowid=(SELECT first.rowid FROM answer_attempts first
               WHERE first.practice_question_id=a.practice_question_id
               ORDER BY first.created_at,first.rowid LIMIT 1);

CREATE VIEW independent_practice_evidence AS
SELECT * FROM practice_first_answers WHERE outcome IN ('correct','wrong') AND used_hint=0;
