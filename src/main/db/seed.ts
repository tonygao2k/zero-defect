/** 迁移 2:种子数据。id 直接用 code,保证稳定、便于测试。 */

export const ROOT_CAUSE_SEEDS: {
  code: string;
  label: string;
  description: string;
  active: 0 | 1;
}[] = [
  {
    code: 'carry_omission',
    label: '进位或退位遗漏',
    description: '加法漏掉进位,或减法漏掉退位',
    active: 1,
  },
  {
    code: 'place_value_error',
    label: '数位对齐错误',
    description: '竖式计算时数位没有对齐,或小数点位置错误',
    active: 1,
  },
  {
    code: 'calculation_error',
    label: '基础计算错误',
    description: '方法正确,但加减乘除的口算或笔算结果算错',
    active: 1,
  },
  {
    code: 'operation_order_error',
    label: '运算顺序错误',
    description: '没有按先乘除后加减、先括号内的顺序计算',
    active: 1,
  },
  {
    code: 'fraction_common_denominator',
    label: '分数通分错误',
    description: '异分母分数加减时通分有误,或直接分子分母分别相加',
    active: 1,
  },
  {
    code: 'unit_omission',
    label: '单位遗漏或单位混淆',
    description: '漏写单位,或单位换算、单位名称用错',
    active: 1,
  },
  {
    code: 'reading_comprehension_error',
    label: '题意理解错误',
    description: '没读懂题目条件或问题,选错了数量关系',
    active: 1,
  },
  {
    code: 'formula_confusion',
    label: '公式或概念混淆',
    description: '把周长和面积等公式、概念弄混',
    active: 1,
  },
  // 系统保留项:承接模型返回的未知归因,不参与练习调度。
  {
    code: 'needs_review',
    label: '待人工确认',
    description: '模型给出了不在清单内的归因,需家长改选',
    active: 0,
  },
];

export const CURRICULUM_SEEDS = [
  {
    id: 'pep_primary_math',
    stage: 'primary',
    edition: '人教版',
    label: '人教版小学数学',
  },
] as const;

/** 各学段通用的知识点,不属于任何教材。other 是系统保留项,模型没有合适选项时使用。 */
export const GENERIC_KNOWLEDGE_POINTS = [
  { code: 'other', label: '其他' },
] as const;

type Placement = [grade: number, semester: 1 | 2, code: string, label: string];

/**
 * 人教版小学数学的初始编排(按章节归并,偏重计算与数量关系)。
 * 这是初稿,上线前请对照孩子实际使用的教材版次核对。
 * 新增学段或版本:新增一份同结构的数组和 CURRICULUM_SEEDS 条目即可。
 */
export const PEP_PRIMARY_MATH: Placement[] = [
  [1, 1, 'num_within_20', '20 以内数的认识'],
  [1, 1, 'add_sub_within_10', '10 以内加减法'],
  [1, 1, 'add_carry_within_20', '20 以内进位加法'],
  [1, 1, 'clock_reading', '认识钟表'],
  [1, 2, 'sub_borrow_within_20', '20 以内退位减法'],
  [1, 2, 'num_within_100', '100 以内数的认识'],
  [1, 2, 'rmb', '认识人民币'],
  [1, 2, 'add_sub_within_100_basic', '100 以内加减法(整十数、不进位退位)'],
  [1, 2, 'pattern', '找规律'],
  [2, 1, 'length_unit', '长度单位(厘米、米)'],
  [2, 1, 'add_sub_within_100', '100 以内加减法(进位、退位、连加连减)'],
  [2, 1, 'angle_basic', '角的初步认识'],
  [2, 1, 'mul_table', '表内乘法'],
  [2, 1, 'time_basic', '认识时间'],
  [2, 2, 'div_table', '表内除法'],
  [2, 2, 'mixed_operations_basic', '混合运算(同级运算与括号)'],
  [2, 2, 'div_with_remainder', '有余数的除法'],
  [2, 2, 'num_within_10000', '万以内数的认识'],
  [2, 2, 'mass_unit_g_kg', '克和千克'],
  [3, 1, 'time_unit_hms', '时、分、秒'],
  [3, 1, 'add_sub_within_10000', '万以内加减法'],
  [3, 1, 'unit_conversion', '长度、质量单位换算'],
  [3, 1, 'multiple_concept', '倍的认识'],
  [3, 1, 'mul_by_one_digit', '多位数乘一位数'],
  [3, 1, 'perimeter', '长方形和正方形的周长'],
  [3, 1, 'fraction_basic', '分数的初步认识'],
  [3, 2, 'div_by_one_digit', '除数是一位数的除法'],
  [3, 2, 'mul_two_digit', '两位数乘两位数'],
  [3, 2, 'area_rect', '长方形和正方形的面积'],
  [3, 2, 'calendar', '年、月、日'],
  [3, 2, 'decimal_basic', '小数的初步认识'],
  [3, 2, 'statistics_table', '复式统计表'],
  [4, 1, 'large_numbers', '大数的认识'],
  [4, 1, 'mul_three_digit', '三位数乘两位数'],
  [4, 1, 'div_two_digit', '除数是两位数的除法'],
  [4, 1, 'angle_measure', '角的度量'],
  [4, 1, 'parallel_perpendicular', '平行与垂直、平行四边形和梯形'],
  [4, 1, 'statistics_bar', '条形统计图'],
  [4, 2, 'operation_order', '四则运算顺序'],
  [4, 2, 'arithmetic_laws', '运算定律与简便计算'],
  [4, 2, 'decimal_meaning', '小数的意义和性质'],
  [4, 2, 'decimal_add_sub', '小数加减法'],
  [4, 2, 'triangle', '三角形'],
  [4, 2, 'average', '平均数'],
  [5, 1, 'decimal_mul', '小数乘法'],
  [5, 1, 'decimal_div', '小数除法'],
  [5, 1, 'simple_equation', '简易方程'],
  [5, 1, 'polygon_area', '多边形的面积'],
  [5, 1, 'probability_basic', '可能性'],
  [5, 2, 'factors_multiples', '因数与倍数'],
  [5, 2, 'cuboid_cube', '长方体和正方体(表面积、体积)'],
  [5, 2, 'fraction_meaning', '分数的意义和性质(约分、通分)'],
  [5, 2, 'fraction_add_sub', '分数加减法'],
  [5, 2, 'line_chart', '折线统计图'],
  [6, 1, 'fraction_mul', '分数乘法'],
  [6, 1, 'fraction_div', '分数除法'],
  [6, 1, 'ratio', '比'],
  [6, 1, 'circle', '圆的周长和面积'],
  [6, 1, 'percent', '百分数(一)'],
  [6, 2, 'negative_numbers', '负数'],
  [6, 2, 'percent_applications', '百分数(二)(折扣、成数、税率、利率)'],
  [6, 2, 'cylinder_cone', '圆柱与圆锥'],
  [6, 2, 'proportion', '比例'],
];
