import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('NSIS source encoding', () => {
  for (const file of [
    'installer/MD-Split.nsi',
    'installer/DirectoryValidation.nsh',
    'tests/installer/DirectoryChecks.nsi',
  ]) {
    it(`${file} declares UTF-8 with a BOM`, () => {
      const bytes = readFileSync(new URL('../' + file, import.meta.url));
      expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).not.toThrow();
    });
  }

  it('retains Japanese installer text and the Japanese directory fixture', () => {
    const decode = file => new TextDecoder('utf-8', { fatal: true }).decode(
      readFileSync(new URL('../' + file, import.meta.url)),
    );
    expect(decode('installer/MD-Split.nsi')).toContain('MD-CSV Split Editor をセットアップ');
    expect(decode('installer/MD-Split.nsi')).toContain('Windowsへの登録を選んでください');
    expect(decode('tests/installer/DirectoryChecks.nsi')).toContain('日本語と space');
  });
});
