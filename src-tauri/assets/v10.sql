ALTER TABLE mistakes ADD COLUMN original_question_since TEXT;

-- Old rows only establish when the currently stored wording and classification were saved.
UPDATE mistakes
SET original_question_since=updated_at
WHERE status='active' AND julianday(updated_at) IS NOT NULL;

ALTER TABLE practice_questions ADD COLUMN matches_original_at_dispatch INTEGER NOT NULL DEFAULT 0
  CHECK (matches_original_at_dispatch IN (0,1));
