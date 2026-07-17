import { describe, it, expect } from 'vitest';
import pkg from '../package.json';

describe('scaffold', () => {
  it('has exactly the allowed deps', () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['exceljs', 'highs']);
    expect(pkg.type).toBe('module');
  });
});
