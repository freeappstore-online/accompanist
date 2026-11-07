import { expect, it } from 'vitest';
import { parseCommand } from './commands';

it.each([
  ['from bar 9', { type: 'from', bar: 9 }],
  ['Play from bar nine.', { type: 'from', bar: 9 }],
  ['measure twenty-one', { type: 'from', bar: 21 }],
  ['go to bar for', { type: 'from', bar: 4 }],
  ['from bar one hundred and three', { type: 'from', bar: 103 }],
  ['from bar twelve please', { type: 'from', bar: 12 }],
  ['from the beginning', { type: 'from', bar: 1 }],
  ['take it from the top', { type: 'from', bar: 1 }],
  ['stop', { type: 'stop' }],
  ['wait', { type: 'stop' }],
  ['a bit slower', { type: 'tempo', factor: .9 }],
  ['faster', { type: 'tempo', factor: 1.1 }],
  ['play', { type: 'play' }],
  ['continue', { type: 'play' }],
])('%s', (phrase, command) => expect(parseCommand(phrase)).toEqual(command));

it('ignores singing and bar without a number', () => {
  expect(parseCommand('three blind mice see how they run')).toBeNull();
  expect(parseCommand('the bar was closed')).toBeNull();
});
