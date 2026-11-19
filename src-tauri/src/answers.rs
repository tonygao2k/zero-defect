use regex::Regex;
use std::sync::LazyLock;
use unicode_normalization::UnicodeNormalization;
static DOTS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\\(?:cdots|ldots|dots)|\.{2,}|⋯|余").unwrap());
static REPEATS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"…+").unwrap());
static NUMBER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^-?\d+(?:\.\d+)?$").unwrap());
pub fn normalize(input: &str) -> String {
    let s = input
        .nfkc()
        .filter(|c| !c.is_whitespace() && *c != '$')
        .collect::<String>();
    let s = DOTS.replace_all(&s, "…");
    let s = REPEATS.replace_all(&s, "…");
    let chars = s.chars().collect::<Vec<_>>();
    let s = chars
        .iter()
        .enumerate()
        .filter_map(|(i, c)| {
            if *c == ','
                && i > 0
                && chars[i - 1].is_ascii_digit()
                && chars
                    .get(i + 1..i + 4)
                    .is_some_and(|v| v.iter().all(char::is_ascii_digit))
                && !chars.get(i + 4).is_some_and(char::is_ascii_digit)
            {
                None
            } else {
                Some(*c)
            }
        })
        .collect::<String>();
    s.trim_end_matches(['。', '.']).to_lowercase()
}
pub fn same(student: &str, correct: &str) -> bool {
    let s = normalize(student);
    !s.is_empty() && s == normalize(correct)
}
pub fn is_mistake_evidence(student: &str, work: &str, correct: &str) -> bool {
    !correct.trim().is_empty()
        && (!student.trim().is_empty() || !work.trim().is_empty())
        && !same(student, correct)
}
pub fn check(kind: &str, submitted: &str, correct: &str, unit: &str) -> bool {
    let s = normalize(submitted);
    let c = normalize(correct);
    if kind == "choice" {
        return !s.is_empty() && s.chars().next() == c.chars().next();
    }
    let u = normalize(unit);
    let s = if u.is_empty() {
        s.as_str()
    } else {
        s.strip_suffix(&u).unwrap_or(&s)
    };
    let c = if u.is_empty() {
        c.as_str()
    } else {
        c.strip_suffix(&u).unwrap_or(&c)
    };
    !s.is_empty()
        && !c.is_empty()
        && (s == c
            || (NUMBER.is_match(s)
                && NUMBER.is_match(c)
                && s.parse::<f64>().ok() == c.parse::<f64>().ok()))
}
