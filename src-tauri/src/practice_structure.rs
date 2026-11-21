use crate::{db, figure, state::PracticeDifficulty};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::LazyLock;
use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FigureKind {
    CubeNet,
    CubeStack,
    NumberLine,
    BarChart,
}

impl FigureKind {
    fn from_name(name: &str) -> Option<Self> {
        match name {
            "cube_net" => Some(Self::CubeNet),
            "cube_stack" => Some(Self::CubeStack),
            "number_line" => Some(Self::NumberLine),
            "bar_chart" => Some(Self::BarChart),
            _ => None,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::CubeNet => "cube_net",
            Self::CubeStack => "cube_stack",
            Self::NumberLine => "number_line",
            Self::BarChart => "bar_chart",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "kind", content = "figure", rename_all = "snake_case")]
pub enum Structure {
    Calculation,
    Application,
    Figure(FigureKind),
    Unknown,
}

#[derive(Clone)]
pub struct RecheckRequirement {
    pub structure: Structure,
    pub level: PracticeDifficulty,
}

impl RecheckRequirement {
    pub fn accepts_structure(&self, candidate: Structure) -> bool {
        self.structure != Structure::Unknown && self.structure == candidate
    }

    pub fn accepts(&self, structure: Structure, level: i64) -> bool {
        self.accepts_structure(structure) && self.level.code() == level
    }

    pub fn instructions(&self) -> String {
        match self.structure {
            Structure::Calculation => "复测须为直接计算或单位换算题。".into(),
            Structure::Application => "复测须为有完整生活情境的应用题。题干提供情境中的已知数量，并询问该情境中的未知量，由学生选择数量关系。不要直接给出算式。".into(),
            Structure::Figure(kind) => format!(
                "复测须依赖配图作答，figure.type 必须为 {}。题干应明确引用图中的信息。",
                kind.name()
            ),
            Structure::Unknown => String::new(),
        }
    }
}

static EXPRESSION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[-+]?\(?\d[0-9.()+×*/÷:%−°²³=-]*[+×*/÷:−=-][0-9.()+×*/÷:%−°²³=_□?-]*$").unwrap()
});
static INLINE_FORMULA: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\d[0-9.)%]*[+×*/÷−=-][(+-]*\d|\d=\?|\\(?:frac|times|div)").unwrap()
});
static DIRECT_CONVERSION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:\d+(?:\.\d+)?(?:千米|毫米|厘米|分米|米|吨|千克|克|小时|时|分钟|分|秒|升|毫升|km|cm|mm|dm|m|kg|g|h|min|s)){1,2}(?:=|是|等于|一共是|换算成)(?:多少|\(\)|□|_+)[\p{Han}a-z]+\??$").unwrap()
});
static CONTEXT_QUANTITY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"[\p{Han}]{2,}[0-9一二两三四五六七八九十百千万]+(?:\.\d+)?(?:千克|克|吨|千米|厘米|米|小时|分钟|秒|毫升|升|元|角|本|支|枝|束|块|盒|箱|个|辆|人|张|件|袋|只|颗|条|棵|页|瓶|盘|站|分)").unwrap()
});
static CONTEXT_ACTION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"有|放|摆|装|买|卖|运|送|拿|借|还|用|花|做|种|摘|读|看|分给|收到|付|走|跑|行驶|经过|距离|重|长|宽|高|速度|温度").unwrap()
});
static CONTEXT_GOAL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:多少|几)(?:千克|克|吨|千米|厘米|米|小时|分钟|秒|毫升|升|元|角|本|支|枝|束|块|盒|箱|个|辆|人|张|件|袋|只|颗|条|棵|页|瓶|盘|站|分)[\p{Han}]*\??$").unwrap()
});

impl Structure {
    pub fn inspect(markdown: &str, raw_figure: &Value, template: bool) -> Self {
        let Some(figure) = figure::validate(raw_figure) else {
            return Self::Unknown;
        };
        if !figure.is_null() {
            let declared = db::text(&figure, "type");
            let referred = figure::infer(markdown);
            return FigureKind::from_name(declared)
                .filter(|_| referred == declared || referred == "other")
                .map_or(Self::Unknown, Self::Figure);
        }
        if template {
            return Self::Calculation;
        }
        let prompt: String = markdown
            .nfkc()
            .filter(|c| !c.is_whitespace() && !matches!(c, '*' | '$' | '`'))
            .collect();
        let prompt = prompt
            .replace("\\times", "×")
            .replace("\\div", "÷")
            .replace("\\cdot", "×")
            .replace("\\;", "")
            .replace("\\,", "")
            .to_lowercase();
        let direct = [
            "请用竖式计算",
            "用竖式计算",
            "竖式计算",
            "请计算",
            "计算",
            "算一算",
        ]
        .iter()
        .find_map(|prefix| prompt.strip_prefix(prefix))
        .unwrap_or(&prompt)
        .trim_start_matches(':');
        let expression = [
            "的得数是多少?",
            "得数是多少?",
            "的结果是多少?",
            "结果是多少?",
            "的商和余数分别是多少?",
            "商和余数分别是多少?",
        ]
        .iter()
        .find_map(|suffix| direct.strip_suffix(suffix))
        .unwrap_or(direct)
        .trim_end_matches([',', '。', '，']);
        if EXPRESSION.is_match(expression) || DIRECT_CONVERSION.is_match(direct) {
            return Self::Calculation;
        }

        // Require concrete context and a question about that context. An unfamiliar
        // prompt or a dressed-up expression provides no evidence of application.
        if let Some((given, goal)) = prompt.rsplit_once([',', '。', ';', '：', ':']) {
            if CONTEXT_ACTION.is_match(given)
                && CONTEXT_QUANTITY.is_match(given)
                && CONTEXT_GOAL.is_match(goal)
                && !["得数", "算式", "计算结果", "两个数的和"]
                    .iter()
                    .any(|word| goal.contains(word))
                && !INLINE_FORMULA.is_match(&prompt)
            {
                return Self::Application;
            }
        }
        Self::Unknown
    }

    pub fn from_storage(markdown: &str, figure_json: Option<&str>, verify_json: &Value) -> Self {
        let Some(figure) =
            figure_json.map_or(Some(Value::Null), |json| serde_json::from_str(json).ok())
        else {
            return Self::Unknown;
        };
        let inferred = Self::inspect(markdown, &figure, verify_json["source"] == "template");
        match verify_json.get("structure") {
            Some(saved) if serde_json::from_value::<Self>(saved.clone()).ok() != Some(inferred) => {
                Self::Unknown
            }
            _ => inferred,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn application_requires_a_quantified_situation_and_a_question_about_it() {
        let classify = |prompt| Structure::inspect(prompt, &Value::Null, false);
        for prompt in [
            "计算：58+27，得数是多少？",
            "用竖式计算：$58+27=\\;?$",
            "１２×１３＝（ ）",
            "2 千克等于多少克？",
        ] {
            assert_eq!(classify(prompt), Structure::Calculation, "{prompt}");
        }
        for prompt in [
            "试着求出这个算式的值：58+27。这道练习的答案是多少？",
            "把 58 和 27 放在一起，最后得到哪个数？",
            "小明买了 58 本书，问 58+27 的得数是多少本？",
            "已知一些条件，请猜一猜。",
        ] {
            assert_eq!(classify(prompt), Structure::Unknown, "{prompt}");
        }
        let application = "花店上午卖了 58 束花，下午卖了 27 束花，全天卖了多少束花？";
        assert_eq!(classify(application), Structure::Application);
        assert_eq!(
            Structure::from_storage(application, None, &json!({"solver":"85"})),
            Structure::Application
        );
        assert_eq!(
            Structure::from_storage(application, Some("{"), &Value::Null),
            Structure::Unknown
        );
        assert_eq!(
            Structure::from_storage(
                "计算：58+27，得数是多少？",
                None,
                &json!({
                    "structure":{"kind":"application"}
                })
            ),
            Structure::Unknown
        );
    }

    #[test]
    fn attached_figure_requires_a_reference_and_a_supported_matching_type() {
        let chart = json!({"type":"bar_chart","unit":"本","bars":[{"label":"甲","value":8},{"label":"乙","value":7}]});
        let requirement = RecheckRequirement {
            structure: Structure::Figure(FigureKind::BarChart),
            level: PracticeDifficulty::Medium,
        };
        let ask_chart = Structure::inspect("条形统计图中，两组共有多少本？", &chart, false);
        assert!(requirement.accepts(ask_chart, 1));
        assert!(!requirement.accepts(ask_chart, 2));
        for prompt in ["计算：8 + 7 = ?", "数轴上的点 A 表示哪个数？"] {
            assert_eq!(
                Structure::inspect(prompt, &chart, false),
                Structure::Unknown
            );
        }
    }
}
