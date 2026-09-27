'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateImposition,
  parseReprintQuantities,
  planReprintProduction,
  buildReprintProductionCsv,
} = require('../src/imposition');

/* ---------- 「页码:份数」输入解析 ---------- */

test('份数解析：逗号分隔的「页码:份数」（如 2:5,7:3）', () => {
  assert.deepEqual(parseReprintQuantities('2:5,7:3', 8), {
    items: [
      { page: 2, copies: 5 },
      { page: 7, copies: 3 },
    ],
  });
  assert.deepEqual(parseReprintQuantities('1:1', 8), { items: [{ page: 1, copies: 1 }] });
});

test('份数解析：按页码升序排列，与输入顺序无关', () => {
  assert.deepEqual(parseReprintQuantities('7:3,2:5,4:1', 8), {
    items: [
      { page: 2, copies: 5 },
      { page: 4, copies: 1 },
      { page: 7, copies: 3 },
    ],
  });
});

test('份数解析：兼容全角冒号、全角逗号与空白字符', () => {
  assert.deepEqual(parseReprintQuantities('2：5，7：3', 8), {
    items: [
      { page: 2, copies: 5 },
      { page: 7, copies: 3 },
    ],
  });
  assert.deepEqual(parseReprintQuantities(' 2 : 5 , 7 : 3 ', 8), {
    items: [
      { page: 2, copies: 5 },
      { page: 7, copies: 3 },
    ],
  });
});

test('份数解析：页码不可重复', () => {
  assert.match(parseReprintQuantities('2:5,2:3', 8).error, /第 2 页重复出现/);
  assert.match(parseReprintQuantities('2:5,2:5', 8).error, /第 2 页重复出现/);
});

test('份数解析：份数须为正整数', () => {
  assert.match(parseReprintQuantities('2:0', 8).error, /第 2 页的份数须为正整数/);
  assert.match(parseReprintQuantities('2:-1', 8).error, /第 2 页的份数须为正整数/);
  assert.match(parseReprintQuantities('2:1.5', 8).error, /第 2 页的份数须为正整数/);
  assert.match(parseReprintQuantities('2:x', 8).error, /第 2 页的份数须为正整数/);
});

test('份数解析：非法输入说明原因', () => {
  for (const bad of ['', '   ', null, undefined]) {
    assert.match(parseReprintQuantities(bad, 8).error, /请输入需返工的页码与份数/);
  }
  assert.match(parseReprintQuantities('2', 8).error, /无法识别的项/);
  assert.match(parseReprintQuantities('2:', 8).error, /无法识别的项/);
  assert.match(parseReprintQuantities(':5', 8).error, /无法识别的项/);
  assert.match(parseReprintQuantities('2:5:3', 8).error, /无法识别的项/);
  assert.match(parseReprintQuantities('x:5', 8).error, /无法识别的页码/);
  assert.match(parseReprintQuantities('2:5,', 8).error, /空项/);
});

test('份数解析：页码范围校验（成品页，不含补齐的空白页位）', () => {
  assert.match(parseReprintQuantities('0:2', 8).error, /第 0 页超出成品页范围 1~8/);
  assert.match(parseReprintQuantities('9:2', 8).error, /第 9 页超出成品页范围 1~8/);
  // 6 页成品补齐至 8 页：第 7、8 页为空白页位，不属于成品页
  assert.match(parseReprintQuantities('7:2', 6).error, /第 7 页超出成品页范围 1~6/);
});

/* ---------- 补印生产单 ---------- */

test('生产单：结构非法返回 null', () => {
  assert.equal(planReprintProduction(null, '1:2'), null);
  assert.equal(planReprintProduction({ pages: 3, totalPages: 8, sheets: [] }, '1:2'), null);
  assert.equal(buildReprintProductionCsv(null, '1:2'), null);
});

test('生产单：同一纸张命中多页时实印份数取各页需求最大值，并列出每页需求与随印超出份数', () => {
  // 8 页：第 1 张 正面[8,1]/反面[2,7]，第 2 张 正面[6,3]/反面[4,5]
  const plan = planReprintProduction(generateImposition(8), '2:5,7:3');
  assert.deepEqual(plan.items, [
    { page: 2, copies: 5 },
    { page: 7, copies: 3 },
  ]);
  assert.equal(plan.sheetCount, 1);
  assert.equal(plan.totalCopies, 5); // 实体纸张总用量 = max(5, 3)
  assert.equal(plan.totalExtra, 2); // 第 7 页随印超出 5-3=2 份
  assert.deepEqual(plan.sheets[0], {
    sheet: 1,
    copies: 5,
    hits: [
      { page: 2, copies: 5, extra: 0 },
      { page: 7, copies: 3, extra: 2 },
    ],
    front: { left: 8, right: 1 },
    back: { left: 2, right: 7 },
  });
  assert.ok(!('sig' in plan.sheets[0])); // 单帖模式不带帖号
});

test('生产单：按帖号、帖内纸张序排列，汇总实体纸张总用量', () => {
  // 8 页：第 2 页在第 1 张，第 4、5 页在第 2 张
  const plan = planReprintProduction(generateImposition(8), '5:6,2:4,4:2');
  assert.deepEqual(
    plan.sheets.map((s) => [s.sheet, s.copies]),
    [
      [1, 4], // 第 1 张：第 2 页需求 4 份
      [2, 6], // 第 2 张：第 4、5 页需求 2、6 份 → 取最大值 6
    ]
  );
  assert.deepEqual(plan.sheets[1].hits, [
    { page: 4, copies: 2, extra: 4 },
    { page: 5, copies: 6, extra: 0 },
  ]);
  assert.equal(plan.totalCopies, 10); // 4 + 6
  assert.equal(plan.totalExtra, 4); // 第 4 页随印超出 4 份
});

test('生产单：跨帖按帖号及帖内纸张序排列', () => {
  // 20 页 M=2：第 1 帖 1~8（2 张）、第 2 帖 9~16（2 张）、第 3 帖 17~20（1 张）
  const plan = planReprintProduction(generateImposition(20, 2), '18:2,2:5,10:3,13:1');
  assert.deepEqual(
    plan.sheets.map((s) => [s.sig, s.sheet, s.copies]),
    [
      [1, 1, 5],
      [2, 1, 3],
      [2, 2, 1],
      [3, 1, 2],
    ]
  );
  assert.equal(plan.totalCopies, 11); // 5 + 3 + 1 + 2
  assert.equal(plan.totalExtra, 0);
  // 清单含该纸正反四个版位
  assert.deepEqual(plan.sheets[1].front, { left: 16, right: 9 });
  assert.deepEqual(plan.sheets[1].back, { left: 10, right: 15 });
});

test('生产单：跨帖同纸多页取最大值', () => {
  // 20 页 M=2：第 9、15 页同在第 2 帖第 1 张
  const plan = planReprintProduction(generateImposition(20, 2), '9:2,15:4');
  assert.equal(plan.sheetCount, 1);
  assert.deepEqual(plan.sheets[0].hits, [
    { page: 9, copies: 2, extra: 2 },
    { page: 15, copies: 4, extra: 0 },
  ]);
  assert.equal(plan.sheets[0].copies, 4);
  assert.equal(plan.totalCopies, 4);
  assert.equal(plan.totalExtra, 2);
});

test('生产单：拼版存在错误时说明原因并拒绝', () => {
  const imp = generateImposition(8);
  [imp.sheets[0].front.left, imp.sheets[1].front.left] = [
    imp.sheets[1].front.left,
    imp.sheets[0].front.left,
  ];
  const plan = planReprintProduction(imp, '2:5');
  assert.match(plan.error, /当前拼版存在错误/);
  assert.ok(plan.errors); // 附带校验错误明细
  const csv = buildReprintProductionCsv(imp, '2:5');
  assert.match(csv.error, /当前拼版存在错误/);
});

test('生产单：输入无效时说明原因', () => {
  const imp = generateImposition(8);
  assert.match(planReprintProduction(imp, '').error, /请输入需返工的页码与份数/);
  assert.match(planReprintProduction(imp, '9:2').error, /超出成品页范围 1~8/);
  assert.match(planReprintProduction(imp, '2:0').error, /份数须为正整数/);
  assert.match(planReprintProduction(imp, '2:1,2:2').error, /第 2 页重复出现/);
  assert.match(planReprintProduction(imp, '2,5').error, /无法识别的项/);
});

test('生产单：启用爬移时清单纸张带补偿量', () => {
  const plan = planReprintProduction(generateImposition(8, null, { thickness: 0.1, cap: 2 }), '5:2');
  assert.equal(plan.sheetCount, 1);
  assert.equal(plan.sheets[0].sheet, 2);
  assert.equal(plan.sheets[0].creep, 0.2);
});

/* ---------- 生产单 CSV ---------- */

test('生产单 CSV：与屏幕结果一致（单帖），末行为合计', () => {
  const { csv, plan } = buildReprintProductionCsv(generateImposition(8), '2:5,7:3');
  assert.equal(plan.totalCopies, 5);
  assert.equal(plan.totalExtra, 2);
  assert.equal(
    csv,
    '﻿纸张序号,实际补印份数,返工页码,页需求份数,随印超出份数\r\n' +
      '1,5,2,5,0\r\n' +
      '1,5,7,3,2\r\n' +
      '合计,5,,,2\r\n'
  );
});

test('生产单 CSV：与屏幕结果一致（分帖），含帖号与帖内纸张序号', () => {
  const { csv, plan } = buildReprintProductionCsv(generateImposition(20, 2), '18:2,2:5');
  assert.equal(plan.totalCopies, 7);
  assert.equal(
    csv,
    '﻿帖号,帖内纸张序号,实际补印份数,返工页码,页需求份数,随印超出份数\r\n' +
      '1,1,5,2,5,0\r\n' +
      '3,1,2,18,2,0\r\n' +
      '合计,,7,,,0\r\n'
  );
});

test('生产单 CSV：输入无效或拼版有错时返回错误（禁止下载）', () => {
  const imp = generateImposition(8);
  assert.match(buildReprintProductionCsv(imp, '').error, /请输入需返工的页码与份数/);
  assert.match(buildReprintProductionCsv(imp, '2:0').error, /份数须为正整数/);

  imp.sheets[0].front.left = 3; // 制造重复页 / 缺页
  assert.match(buildReprintProductionCsv(imp, '2:5').error, /当前拼版存在错误/);
});
