use chrono::{Days, NaiveDate};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stage {
    First,
    Second,
    Long,
    Recovery,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Review {
    pub due: NaiveDate,
    stage: Stage,
}

#[derive(Default)]
pub struct Projection {
    pub mastered: bool,
    pub streak: usize,
    pub review: Option<Review>,
    streak_start: Option<NaiveDate>,
    spans_days: bool,
}

impl Projection {
    pub fn record(
        &mut self,
        date: NaiveDate,
        correct: bool,
        variant: bool,
        legacy_start: NaiveDate,
    ) {
        let due_review = self.review.filter(|review| date >= review.due && variant);
        if correct {
            self.streak += 1;
            self.spans_days |= *self.streak_start.get_or_insert(date) != date;
            if !self.mastered && self.streak >= 3 && self.spans_days {
                self.mastered = true;
                self.review = Some(Review {
                    due: (date + Days::new(7)).max(legacy_start),
                    stage: Stage::First,
                });
            } else if let Some(review) = due_review {
                self.review = match review.stage {
                    Stage::First => Some(Review {
                        due: date + Days::new(14),
                        stage: Stage::Second,
                    }),
                    Stage::Second | Stage::Long => Some(Review {
                        due: date + Days::new(30),
                        stage: Stage::Long,
                    }),
                    Stage::Recovery => None,
                };
            }
        } else {
            self.streak = 0;
            self.streak_start = None;
            self.spans_days = false;
            self.mastered = false;
            self.review = due_review.map(|_| Review {
                due: date + Days::new(1),
                stage: Stage::Recovery,
            });
        }
    }

    pub fn waiting_for_recovery(&self, today: NaiveDate) -> bool {
        self.review
            .is_some_and(|review| review.stage == Stage::Recovery && review.due > today)
    }
}
