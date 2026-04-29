import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskPrompt } from '../../modules/taskRouter.js';
import { buildAssistantSessionContent } from '../../modules/replyFormat.js';

test('taskRouter keeps explicit symbol query unchanged', () => {
  const prompt = buildTaskPrompt({
    query: '分析平安银行后续操作',
    task: 'full_analysis',
    history: [{ role: 'assistant', content: '此前讨论了 600519' }],
    historyText: 'assistant: 此前讨论了 600519',
  });
  assert.match(prompt, /用户请求：分析平安银行后续操作/);
  assert.doesNotMatch(prompt, /默认沿用上一轮标的/);
});

test('taskRouter resolves follow-up symbol from history', () => {
  const prompt = buildTaskPrompt({
    query: '这个股票现在怎么操作',
    task: 'full_analysis',
    history: [
      { role: 'user', content: '分析下宁德时代' },
      { role: 'assistant', content: '宁德时代(300750) 当前建议...' },
    ],
    historyText: 'assistant: 宁德时代(300750) 当前建议...',
  });
  assert.match(prompt, /默认沿用上一轮标的：300750/);
  assert.match(prompt, /与上一轮相比的变化点/);
});

test('taskRouter does not treat as follow-up without prior assistant', () => {
  const prompt = buildTaskPrompt({
    query: '这个股票怎么办',
    task: 'full_analysis',
    history: [{ role: 'user', content: '你好' }],
    historyText: 'user: 你好',
  });
  assert.doesNotMatch(prompt, /与上一轮相比的变化点/);
});

test('taskRouter treats short 吗 question as follow-up when assistant exists', () => {
  const prompt = buildTaskPrompt({
    query: '还会涨吗',
    task: 'full_analysis',
    history: [
      { role: 'user', content: '看看比亚迪' },
      { role: 'assistant', content: 'BYD（002594）短线偏强...' },
    ],
    historyText: 'assistant: BYD（002594）短线偏强...',
  });
  assert.match(prompt, /默认沿用上一轮标的：002594/);
  assert.match(prompt, /与上一轮相比的变化点/);
});

test('taskRouter picks 6-digit code in full-width parens from assistant', () => {
  const prompt = buildTaskPrompt({
    query: '止损放哪合适',
    task: 'full_analysis',
    history: [
      { role: 'user', content: '茅台呢' },
      { role: 'assistant', content: '贵州茅台（600519）最新收盘...' },
    ],
    historyText: 'assistant: 贵州茅台（600519）最新收盘...',
  });
  assert.match(prompt, /默认沿用上一轮标的：600519/);
});

test('buildAssistantSessionContent merges decision block and analysis', () => {
  const text = buildAssistantSessionContent({
    analysis: '分析正文',
    decision: {
      action: 'watch',
      confidence: 55,
      reasons: ['箱体震荡'],
      risks: ['破位'],
      plan: { entry: '', stopLoss: '', takeProfit: '', position: '轻仓' },
    },
  });
  assert.match(text, /【结构化决策】/);
  assert.match(text, /【详细分析】\n分析正文/);
});
