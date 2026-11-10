import {describe,it,expect} from 'vitest';
import {preferredLanguage,normalizeLanguage,setUiLanguage,currentUiLanguage} from '../src/i18n.js';

describe('interface language selection',()=>{
  it('chooses Japanese for Japanese or unavailable locale and English for unsupported languages',()=>{
    expect(preferredLanguage('ja-JP')).toBe('ja');expect(preferredLanguage('ja')).toBe('ja');
    expect(preferredLanguage('en-US')).toBe('en');expect(preferredLanguage('fr-FR')).toBe('en');expect(preferredLanguage('')).toBe('ja');
  });
  it('preserves explicit user selections and falls back safely',()=>{
    expect(normalizeLanguage('en','ja-JP')).toBe('en');expect(normalizeLanguage('ja','fr')).toBe('ja');expect(normalizeLanguage('unexpected','fr')).toBe('en');
    setUiLanguage('en');expect(currentUiLanguage()).toBe('en');setUiLanguage('ja');expect(currentUiLanguage()).toBe('ja');
  });
});
