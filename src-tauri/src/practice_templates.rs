use crate::{answers, state::PracticeDifficulty};
use regex::Regex;
use serde::Serialize;
use std::sync::LazyLock;
use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Copy)]
pub enum Family {
    Remainder,
    Columns { limit: u32, addition: Option<bool> },
    Conversion(UnitSet),
}

#[derive(Clone, Copy)]
pub enum UnitSet {
    Length,
    Mass,
    Time,
    Metric,
}

pub fn family(point: &str, cause: &str) -> Option<Family> {
    let arithmetic = matches!(
        cause,
        "carry_omission" | "place_value_error" | "calculation_error"
    );
    let units = matches!(cause, "unit_omission" | "calculation_error");
    match point {
        "div_with_remainder"
            if matches!(
                cause,
                "remainder_ge_divisor" | "calculation_error" | "times_table_recall"
            ) =>
        {
            Some(Family::Remainder)
        }
        "add_carry_within_20" if arithmetic && cause != "place_value_error" => {
            Some(Family::Columns {
                limit: 20,
                addition: Some(true),
            })
        }
        "sub_borrow_within_20" if arithmetic && cause != "place_value_error" => {
            Some(Family::Columns {
                limit: 20,
                addition: Some(false),
            })
        }
        "add_sub_within_100" if arithmetic => Some(Family::Columns {
            limit: 100,
            addition: None,
        }),
        "add_sub_within_10000" if arithmetic => Some(Family::Columns {
            limit: 10000,
            addition: None,
        }),
        "length_unit" if units => Some(Family::Conversion(UnitSet::Length)),
        "mass_unit_g_kg" if units => Some(Family::Conversion(UnitSet::Mass)),
        "time_unit_hms" if units => Some(Family::Conversion(UnitSet::Time)),
        "unit_conversion" if units => Some(Family::Conversion(UnitSet::Metric)),
        _ => None,
    }
}

#[derive(Clone, Copy)]
struct Units {
    large: &'static str,
    small: &'static str,
    factor: u32,
}

const LENGTH: [Units; 1] = [Units {
    large: "米",
    small: "厘米",
    factor: 100,
}];
const MASS: [Units; 1] = [Units {
    large: "千克",
    small: "克",
    factor: 1000,
}];
const TIME: [Units; 2] = [
    Units {
        large: "时",
        small: "分",
        factor: 60,
    },
    Units {
        large: "分",
        small: "秒",
        factor: 60,
    },
];
const METRIC: [Units; 7] = [
    LENGTH[0],
    MASS[0],
    Units {
        large: "千米",
        small: "米",
        factor: 1000,
    },
    Units {
        large: "米",
        small: "分米",
        factor: 10,
    },
    Units {
        large: "分米",
        small: "厘米",
        factor: 10,
    },
    Units {
        large: "厘米",
        small: "毫米",
        factor: 10,
    },
    Units {
        large: "吨",
        small: "千克",
        factor: 1000,
    },
];

#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
enum Parameters {
    Remainder {
        dividend: u32,
        divisor: u32,
        option_offset: usize,
    },
    Columns {
        left: u32,
        right: u32,
        addition: bool,
        limit: u32,
    },
    Conversion {
        large_unit: &'static str,
        small_unit: &'static str,
        factor: u32,
        whole: u32,
        extra: u32,
        reverse: bool,
    },
    ConversionComplement {
        centimeters: u32,
    },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    version: u32,
    seed: u32,
    numeric_limit: u32,
    parameters: Parameters,
    pub fingerprint: String,
}

pub struct TemplateQuestion {
    pub markdown: String,
    pub options: Vec<String>,
    pub correct: String,
    pub unit: &'static str,
    pub solution: String,
    pub metadata: Metadata,
}

struct Random(u64);

impl Random {
    // SplitMix64 keeps the sequence stable across platforms and dependency updates.
    fn range(&mut self, min: u32, max: u32) -> u32 {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut value = self.0;
        value = (value ^ (value >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94d049bb133111eb);
        min + ((value ^ (value >> 31)) % u64::from(max - min + 1)) as u32
    }
}

pub fn generate(
    family: Family,
    difficulty: &PracticeDifficulty,
    numeric_limit: u32,
    seed: u32,
) -> Option<TemplateQuestion> {
    let mut random = Random(u64::from(seed));
    let level = difficulty.code() as u32;
    let parameters = match family {
        Family::Remainder => {
            let divisor = random.range([2, 3, 5][level as usize], [5, 8, 9][level as usize]);
            let quotient = random.range([1, 3, 6][level as usize], [5, 8, 9][level as usize]);
            let remainder = random.range(if level == 2 { divisor / 2 } else { 1 }, divisor - 1);
            Parameters::Remainder {
                dividend: divisor * quotient + remainder,
                divisor,
                option_offset: random.range(0, 3) as usize,
            }
        }
        Family::Columns { limit, addition } => {
            let addition = addition.unwrap_or_else(|| random.range(0, 1) == 0);
            let range = match (limit, level) {
                (20, 0) => (3, 7),
                (20, _) => (2, 9),
                (100, 0) => (12, 39),
                (100, _) => (13, 89),
                (10000, 0) => (100, 899),
                (10000, _) => (1000, 8999),
                _ => return None,
            };
            let (left, right) = (0..64).find_map(|_| {
                let first = random.range(range.0, range.1);
                let second = random.range(range.0, range.1);
                let (left, right) = match (limit, addition) {
                    (20, false) => (first + 10, second),
                    (_, false) => (first.max(second), first.min(second)),
                    _ => (first, second),
                };
                let transfers = column_steps(left, right, addition, &mut String::new());
                let enough = if limit == 10000 && level == 2 { 2 } else { 1 };
                (transfers >= enough && (if addition { left + right } else { left }) <= limit)
                    .then_some((left, right))
            })?;
            Parameters::Columns {
                left,
                right,
                addition,
                limit,
            }
        }
        Family::Conversion(set) => {
            let choices = match set {
                UnitSet::Length => &LENGTH[..],
                UnitSet::Mass => &MASS[..],
                UnitSet::Time => &TIME[..],
                UnitSet::Metric => &METRIC[..],
            };
            let units = choices[random.range(0, choices.len() as u32 - 1) as usize];
            if level == 2 && matches!(set, UnitSet::Length) && numeric_limit == 100 {
                Parameters::ConversionComplement {
                    centimeters: random.range(1, 99),
                }
            } else {
                let extra = if level == 2 {
                    random.range(1, units.factor - 1)
                } else {
                    0
                };
                let whole_max = ((numeric_limit.saturating_sub(extra)) / units.factor)
                    .min(if level == 0 { 9 } else { 30 });
                if whole_max == 0 {
                    return None;
                }
                Parameters::Conversion {
                    large_unit: units.large,
                    small_unit: units.small,
                    factor: units.factor,
                    whole: random.range(1, whole_max),
                    extra,
                    reverse: level == 1 && random.range(0, 1) == 0,
                }
            }
        }
    };
    Some(render(parameters, numeric_limit, seed))
}

fn render(parameters: Parameters, numeric_limit: u32, seed: u32) -> TemplateQuestion {
    let (markdown, options, correct, unit, solution) = match parameters {
        Parameters::Remainder {
            dividend,
            divisor,
            option_offset,
        } => {
            let quotient = dividend / divisor;
            let remainder = dividend % divisor;
            let format_option = |q, r| format!("商 {q}，余数 {r}");
            let mut options = vec![
                format_option(quotient, remainder),
                format_option(quotient - 1, remainder + divisor),
                format_option(quotient, remainder + 1),
                format_option(quotient + 1, remainder),
            ];
            options.rotate_right(option_offset);
            (
                format!("算一算：${dividend}÷{divisor}$ 的商和余数分别是多少？"),
                options,
                char::from(b'A' + option_offset as u8).to_string(),
                "",
                format!("${divisor}×{quotient}={}$，再用 ${dividend}-{}={remainder}$ 求余数。余数 {remainder} 小于除数 {divisor}，所以商是 {quotient}，余数是 {remainder}。", dividend - remainder, dividend - remainder),
            )
        }
        Parameters::Columns {
            left,
            right,
            addition,
            limit,
        } => {
            let (operator, result) = if addition {
                ('+', left + right)
            } else {
                ('-', left - right)
            };
            let intro = if limit == 20 {
                "算一算"
            } else {
                "用竖式计算"
            };
            let mut steps = String::new();
            column_steps(left, right, addition, &mut steps);
            (
                format!("{intro}：${left}{operator}{right}=\\;?$"),
                vec![],
                result.to_string(),
                "",
                format!("把相同数位对齐，从个位算起。\n\n{steps}\n所以结果是 **{result}**。"),
            )
        }
        Parameters::Conversion {
            large_unit,
            small_unit,
            factor,
            whole,
            extra,
            reverse,
        } => {
            let total = whole * factor + extra;
            let relation = format!("1 {large_unit} = {factor} {small_unit}。");
            let (prompt, answer, unit, step) = if reverse {
                (
                    format!("{total} {small_unit} = 多少{large_unit}？"),
                    whole,
                    large_unit,
                    format!("用 {total} 除以 {factor}，得 {whole} {large_unit}。"),
                )
            } else if extra == 0 {
                (
                    format!("{whole} {large_unit} = 多少{small_unit}？"),
                    total,
                    small_unit,
                    format!("用 {whole} 乘 {factor}，得 {total} {small_unit}。"),
                )
            } else {
                (
                    format!("{whole} {large_unit} {extra} {small_unit}一共是多少{small_unit}？"),
                    total,
                    small_unit,
                    format!("先把 {whole} {large_unit} 换成 {} {small_unit}，再加 {extra} {small_unit}，得 {total} {small_unit}。", whole * factor),
                )
            };
            (
                prompt,
                vec![],
                answer.to_string(),
                unit,
                format!("{relation}{step}"),
            )
        }
        Parameters::ConversionComplement { centimeters } => {
            let remaining = 100 - centimeters;
            (
                format!("已有 {centimeters} 厘米，还差多少厘米才是 1 米？"),
                vec![],
                remaining.to_string(),
                "厘米",
                format!("1 米等于 100 厘米。从 100 厘米减去已有的 {centimeters} 厘米，还差 {remaining} 厘米。"),
            )
        }
    };
    let fingerprint = canonical_prompt(&markdown);
    TemplateQuestion {
        markdown,
        options,
        correct,
        unit,
        solution,
        metadata: Metadata {
            version: 1,
            seed,
            numeric_limit,
            parameters,
            fingerprint,
        },
    }
}

fn column_steps(mut left: u32, mut right: u32, addition: bool, steps: &mut String) -> usize {
    let mut transfer = 0;
    let mut count = 0;
    for (index, name) in ["个位", "十位", "百位", "千位", "万位"].iter().enumerate() {
        if left == 0 && right == 0 && transfer == 0 {
            break;
        }
        let a = (left % 10) as i32;
        let b = (right % 10) as i32;
        left /= 10;
        right /= 10;
        let previous = transfer;
        let next = ["十位", "百位", "千位", "万位", "十万位"][index];
        let step = if addition {
            let total = a + b + previous;
            transfer = i32::from(total >= 10);
            let sum = if previous == 1 {
                format!("{a} + {b} + 1（低一位的进位）")
            } else {
                format!("{a} + {b}")
            };
            if transfer == 1 {
                format!("{sum} = {total}，写 {}，向{next}进 1。", total % 10)
            } else {
                format!("{sum} = {total}，写 {total}。")
            }
        } else {
            let difference = a - previous - b;
            transfer = i32::from(difference < 0);
            let difference_text = if previous == 1 {
                format!("{a} - 1（低一位已借走） - {b}")
            } else {
                format!("{a} - {b}")
            };
            if transfer == 1 {
                format!(
                    "向{next}借 1 当 10，{difference_text} + 10 = {}，写 {}。",
                    difference + 10,
                    difference + 10
                )
            } else {
                format!("{difference_text} = {difference}，写 {difference}。")
            }
        };
        count += transfer as usize;
        steps.push_str(&format!("- {name}：{step}\n"));
    }
    count
}

static SIMPLE_EXPRESSION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(\d+)([+÷-])(\d+)(?:=?(?:\?|_+|\(\))?|的商和余数分别是多少\?)$").unwrap()
});
static CONVERSION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(\d+)([a-z\p{Han}]+?)(?:(\d+)([a-z\p{Han}]+?)一共是|=)(?:多少|\(\)|_+)([a-z\p{Han}]+)\??$").unwrap()
});

fn unit_key(unit: &str) -> Option<&'static str> {
    Some(match unit {
        "km" | "千米" | "公里" => "km",
        "m" | "米" => "m",
        "dm" | "分米" => "dm",
        "cm" | "厘米" => "cm",
        "mm" | "毫米" => "mm",
        "t" | "吨" => "t",
        "kg" | "千克" | "公斤" => "kg",
        "g" | "克" => "g",
        "h" | "时" | "小时" => "h",
        "min" | "分" | "分钟" => "min",
        "s" | "秒" | "秒钟" => "s",
        _ => return None,
    })
}

fn conversion_key(expression: &str) -> Option<String> {
    let parts = CONVERSION.captures(expression)?;
    let whole = parts[1].parse::<u32>().ok()?;
    let from = unit_key(&parts[2])?;
    let to = unit_key(&parts[5])?;
    let mut quantity = format!("{whole}{from}");
    if let Some(extra) = parts.get(3) {
        let amount = extra.as_str().parse::<u32>().ok()?;
        let unit = unit_key(&parts[4])?;
        if amount != 0 {
            quantity.push_str(&format!("+{amount}{unit}"));
        }
    }
    Some(format!("conversion:{quantity}={to}"))
}

/// Recognize exact expressions only. Other prompts get typographic normalization.
pub fn canonical_prompt(markdown: &str) -> String {
    let compact = markdown
        .nfkc()
        .filter(|c| !c.is_whitespace() && !matches!(c, '$' | '*' | '`'))
        .map(|c| if c == '−' { '-' } else { c })
        .collect::<String>()
        .replace("\\div", "÷")
        .replace("\\;", "")
        .replace("\\,", "");
    let expression = [
        "用竖式计算:",
        "用竖式计算",
        "竖式计算:",
        "竖式计算",
        "算一算:",
        "计算:",
    ]
    .iter()
    .find_map(|prefix| compact.strip_prefix(prefix))
    .unwrap_or(&compact);
    if let Some(parts) = SIMPLE_EXPRESSION.captures(expression) {
        if let (Ok(mut left), Ok(mut right)) = (parts[1].parse::<u32>(), parts[3].parse::<u32>()) {
            let operator = &parts[2];
            if operator == "+" && left > right {
                std::mem::swap(&mut left, &mut right);
            }
            return format!("expression:{left}{operator}{right}");
        }
    }
    conversion_key(&expression.to_lowercase()).unwrap_or_else(|| answers::normalize(&compact))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hand_checked_examples_cover_remainder_columns_and_conversion() {
        let example = |parameters| render(parameters, 10000, 123);
        let remainder = example(Parameters::Remainder {
            dividend: 29,
            divisor: 6,
            option_offset: 2,
        });
        assert_eq!(remainder.correct, "C");
        assert_eq!(remainder.options[2], "商 4，余数 5");
        assert!(remainder.solution.contains("29-24=5"));

        let addition = example(Parameters::Columns {
            left: 58,
            right: 37,
            addition: true,
            limit: 100,
        });
        assert_eq!(addition.correct, "95");
        assert!(addition.solution.contains("8 + 7 = 15，写 5，向十位进 1"));
        assert!(addition.solution.contains("5 + 3 + 1（低一位的进位） = 9"));

        let subtraction = example(Parameters::Columns {
            left: 1000,
            right: 583,
            addition: false,
            limit: 10000,
        });
        assert_eq!(subtraction.correct, "417");
        assert!(subtraction
            .solution
            .contains("0 - 1（低一位已借走） - 8 + 10 = 1"));
        assert!(subtraction
            .solution
            .contains("1 - 1（低一位已借走） - 0 = 0"));

        let conversion = example(Parameters::Conversion {
            large_unit: "千克",
            small_unit: "克",
            factor: 1000,
            whole: 2,
            extra: 350,
            reverse: false,
        });
        assert_eq!((&*conversion.correct, conversion.unit), ("2350", "克"));
        assert!(conversion.solution.contains("换成 2000 克，再加 350 克"));

        let complement = example(Parameters::ConversionComplement { centimeters: 84 });
        assert_eq!((&*complement.correct, complement.unit), ("16", "厘米"));
    }

    #[test]
    fn generated_parameters_replay_and_match_independent_calculations() {
        let unit_factors = [
            (("米", "厘米"), 100),
            (("千克", "克"), 1000),
            (("时", "分"), 60),
            (("分", "秒"), 60),
            (("千米", "米"), 1000),
            (("米", "分米"), 10),
            (("分米", "厘米"), 10),
            (("厘米", "毫米"), 10),
            (("吨", "千克"), 1000),
        ];
        let families = [
            (Family::Remainder, 10000),
            (
                family("add_carry_within_20", "carry_omission").unwrap(),
                100,
            ),
            (
                family("sub_borrow_within_20", "carry_omission").unwrap(),
                100,
            ),
            (
                family("add_sub_within_100", "place_value_error").unwrap(),
                100,
            ),
            (
                family("add_sub_within_10000", "calculation_error").unwrap(),
                10000,
            ),
            (Family::Conversion(UnitSet::Length), 100),
            (Family::Conversion(UnitSet::Mass), 10000),
            (Family::Conversion(UnitSet::Time), 10000),
            (Family::Conversion(UnitSet::Metric), 10000),
        ];
        for (family, numeric_limit) in families {
            for difficulty in [
                PracticeDifficulty::Easy,
                PracticeDifficulty::Medium,
                PracticeDifficulty::Hard,
            ] {
                let seeds = (0..600).chain([u32::MAX]);
                for seed in seeds {
                    let question = generate(family, &difficulty, numeric_limit, seed).unwrap();
                    let replayed = generate(family, &difficulty, numeric_limit, seed).unwrap();
                    assert_eq!(question.markdown, replayed.markdown);
                    assert_eq!(question.solution, replayed.solution);
                    assert_eq!(question.options, replayed.options);
                    assert_eq!(question.correct, replayed.correct);
                    assert_eq!(
                        question.metadata.fingerprint,
                        canonical_prompt(&question.markdown)
                    );
                    match question.metadata.parameters {
                        Parameters::Remainder {
                            dividend, divisor, ..
                        } => {
                            assert!((2..=9).contains(&divisor) && dividend < 90);
                            let mut left = dividend;
                            let mut quotient = 0;
                            while left >= divisor {
                                left -= divisor;
                                quotient += 1;
                            }
                            assert!((1..=9).contains(&quotient) && left > 0);
                            let expected = format!("商 {quotient}，余数 {left}");
                            assert_eq!(
                                question.options[(question.correct.as_bytes()[0] - b'A') as usize],
                                expected
                            );
                            assert_eq!(
                                question
                                    .options
                                    .iter()
                                    .collect::<std::collections::HashSet<_>>()
                                    .len(),
                                4
                            );
                        }
                        Parameters::Columns {
                            left,
                            right,
                            addition,
                            limit,
                        } => {
                            let result: u32 = question.correct.parse().unwrap();
                            assert!(left <= limit && right <= limit && result <= limit);
                            if addition {
                                assert_eq!(result - right, left);
                            } else {
                                assert_eq!(result + right, left);
                            }
                            assert!(question.solution.contains(if addition {
                                "进 1"
                            } else {
                                "借 1"
                            }));
                            if let Family::Columns {
                                addition: Some(expected),
                                ..
                            } = family
                            {
                                assert_eq!(addition, expected);
                            }
                        }
                        Parameters::Conversion {
                            large_unit,
                            small_unit,
                            factor,
                            whole,
                            extra,
                            reverse,
                        } => {
                            assert!(unit_factors.contains(&((large_unit, small_unit), factor)));
                            assert!(extra < factor && (whole * factor + extra) <= numeric_limit);
                            let result: u32 = question.correct.parse().unwrap();
                            if reverse {
                                assert_eq!(result * factor, whole * factor + extra);
                                assert_eq!(question.unit, large_unit);
                            } else {
                                assert_eq!(result / factor, whole);
                                assert_eq!(result % factor, extra);
                                assert_eq!(question.unit, small_unit);
                            }
                        }
                        Parameters::ConversionComplement { centimeters } => {
                            let result: u32 = question.correct.parse().unwrap();
                            assert_eq!(centimeters + result, 100);
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn canonical_keys_recognize_only_supported_equivalent_forms() {
        assert_eq!(
            canonical_prompt("用竖式计算：$36+27=\\;?$"),
            canonical_prompt("２７ + ３６＝（ ）")
        );
        assert_ne!(canonical_prompt("56-37=?"), canonical_prompt("57-36=?"));
        assert_eq!(
            canonical_prompt("算一算：$29÷6$ 的商和余数分别是多少？"),
            canonical_prompt("$29\\div6=?$")
        );
        assert_eq!(
            canonical_prompt("3 米 0 厘米一共是多少厘米？"),
            canonical_prompt("3m =（ ）cm")
        );
        assert_ne!(
            canonical_prompt("3 米 = 多少厘米？"),
            canonical_prompt("3 米 = 多少毫米？")
        );
        assert!(family("div_with_remainder", "reading_comprehension_error").is_none());
        assert!(family("perimeter", "unit_omission").is_none());
    }
}
