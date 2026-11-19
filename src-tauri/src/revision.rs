use crate::{
    db::{self, exec, one, parsed, text, AppResult},
    repo,
    state::Inner,
};
use serde_json::{json, Value};

pub fn question_for_revision(i: &Inner, id: &str) -> AppResult<Value> {
    one(
        &i.db,
        "SELECT q.* FROM valid_practice_questions q
         JOIN practice_sessions s ON s.id=q.session_id
         LEFT JOIN practice_first_answers a ON a.practice_question_id=q.id
         WHERE q.id=?1 AND s.status='submitted' AND COALESCE(a.outcome,'skipped') IN ('wrong','unsure','skipped')",
        &[&id],
    )?
    .ok_or_else(|| "这道题现在不能订正".into())
}

fn prompts(cause: &str, point: &str, figure: &str) -> [&'static str; 2] {
    match (cause, point, figure) {
        ("formula_confusion", "perimeter" | "area_rect" | "circle", _) => [
            "题目要量的是图形外边一圈，还是图形里面占了多大地方？",
            "看一看已知量的单位：最后一个答案应该用长度单位，还是面积单位？",
        ],
        ("carry_omission", _, _) => [
            "逐位回看，哪一位可能需要进位或借位？",
            "进位或借位后，哪一位的数字需要跟着改？",
        ],
        ("place_value_error", _, _) => [
            "竖式里，你放在同一列的数字表示相同的数位吗？",
            "从个位找起；如果有小数，也找出小数点。需要调整哪一列？",
        ],
        ("operation_order_error", _, _) => [
            "先看看有没有括号，再判断哪一部分应该先算？",
            "把先算的部分圈出来。得到这一步的结果后，剩下的算式是什么？",
        ],
        ("fraction_common_denominator", _, _) => [
            "看看分母：这两个分数的一小份一样大吗？",
            "能不能把两种小份换成同样大小的小份，同时让每个分数的大小不变？",
        ],
        ("unit_omission", _, _) => [
            "圈出每个已知量的单位，再找找题目最后问的单位。它们一样吗？",
            "如果单位不同，你打算把哪个量换成什么单位，再进行比较或计算？",
        ],
        ("times_table_recall", _, _) => [
            "想想这一步用到的两个数：它们对应哪句乘法口诀？",
            "如果一时想不起，能不能从一条你记得的相邻口诀往前或往后推一步？",
        ],
        ("remainder_ge_divisor", _, _) => [
            "看看你算出的余数：剩下的还够再分一组吗？",
            "用你算出的商和余数还原被除数，能和题目给的数对上吗？",
        ],
        ("copy_error", _, _) => [
            "对着原题逐个比一比：写下来的数字、符号和单位都一样吗？",
            "找出第一个没对上的地方。只改这一处，后面的哪一步需要重算？",
        ],
        (_, _, "cube_net" | "cube_stack" | "number_line" | "bar_chart") => [
            "先在图上找到题目点名的位置、标签或观察方向。你找到了哪一处？",
            "从那里开始，还需要从图上找出哪一条信息才能回答问题？",
        ],
        ("calculation_error", _, _) => [
            "先估一估：你的答案大概应该在什么范围？",
            "把算式分成几步重算。哪一步的结果和你第一次不一样？",
        ],
        ("reading_comprehension_error" | "not_attempted", _, _) => [
            "先不算，用自己的话说说：这道题要求你找什么？",
            "题目里哪个条件跟要找的量最有关系？你可以先用它做哪一步？",
        ],
        _ => [
            "先用自己的话说说题目要你找什么，看看有没有漏读条件。",
            "挑出一个有用的条件。它能帮你先确定什么？",
        ],
    }
}

pub fn request_hint(i: &Inner, input: &Value) -> AppResult<Value> {
    let id = repo::required(input, "questionId", 500)?;
    let step = match input["step"].as_u64() {
        Some(step @ (1 | 2)) => step,
        _ => return Err("提示步骤不合法".into()),
    };
    let question = question_for_revision(i, id)?;
    if step == 2 && question["revision_hint_at"].is_null() {
        return Err("请先看第一条提示".into());
    }
    let hints = prompts(
        text(&question, "root_cause_id"),
        text(&question, "knowledge_point_id"),
        text(&parsed(&question, "figure_json"), "type"),
    );
    exec(
        &i.db,
        "UPDATE practice_questions SET revision_hint_at=?1 WHERE id=?2 AND revision_hint_at IS NULL",
        &[&db::now(), &id],
    )?;
    Ok(json!({"step":step,"prompt":hints[(step - 1) as usize]}))
}
