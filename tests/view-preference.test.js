import {describe,it,expect} from 'vitest';
import {initialViewMode,defaultViewMode,presentationFor,updateFileTypeSettings,normalizeFileTypeSettings} from '../src/view-preference.js';

describe('default editor view preference',()=>{
  it('remembers the last user choice by default, including older settings',()=>{
    expect(initialViewMode()).toBe('split');
    expect(initialViewMode({viewMode:'preview'})).toBe('preview');
    expect(initialViewMode({defaultViewMode:'last',viewMode:'source'})).toBe('source');
  });
  it('explicit defaults win over the latest manual choice when opening a file',()=>{
    for(const mode of ['split','source','preview'])expect(initialViewMode({defaultViewMode:mode,viewMode:mode==='split'?'source':'split'})).toBe(mode);
  });
  it('tolerates invalid preferences without accepting arbitrary layout values',()=>{
    expect(defaultViewMode('invalid')).toBe('last');
    expect(initialViewMode({defaultViewMode:'invalid',viewMode:'invalid'})).toBe('split');
  });
});


describe('file-kind presentation settings',()=>{
  it('migrates legacy values once into independent supported kinds',()=>{
    const migrated=normalizeFileTypeSettings({defaultViewMode:'preview',viewMode:'source',sync:false,outlineVisible:false});
    expect(migrated.markdown).toEqual({defaultViewMode:'preview',viewMode:'source',sync:false,outlineVisible:false});expect(migrated.csv).toEqual(migrated.markdown);expect(migrated.html.sync).toBe(false);
    migrated.csv.viewMode='split';expect(migrated.markdown.viewMode).toBe('source');
  });
  it('uses each kind latest selection and fixed default without overwriting other kinds',()=>{
    const original={fileTypeSettings:{markdown:{viewMode:'preview',sync:false},csv:{viewMode:'source',sync:true}}};
    expect(initialViewMode(original,'markdown')).toBe('preview');expect(initialViewMode(original,'csv')).toBe('source');
    const changed=updateFileTypeSettings(original,'csv',{defaultViewMode:'split',viewMode:'preview',sync:false,outlineVisible:true});
    expect(changed.markdown.viewMode).toBe('preview');expect(changed.markdown.sync).toBe(false);expect(changed.csv).toEqual({defaultViewMode:'split',viewMode:'preview',sync:false,outlineVisible:false});expect(initialViewMode({fileTypeSettings:changed},'csv')).toBe('split');expect(original.fileTypeSettings.csv.viewMode).toBe('source');
  });
  it('rejects unknown kinds and values and keeps unsupported features disabled',()=>{
    const value={defaultViewMode:'source',viewMode:'preview',fileTypeSettings:{csv:{viewMode:'invalid',sync:'false',outlineVisible:true},html:{sync:true,outlineVisible:true},unknown:{sync:true}}};
    const normalized=normalizeFileTypeSettings(value);expect(Object.keys(normalized)).toEqual(['markdown','csv','tsv','html']);expect(normalized.csv.viewMode).toBe('preview');expect(normalized.csv.sync).toBe(true);expect(normalized.csv.outlineVisible).toBe(false);expect(normalized.html.sync).toBe(false);expect(normalized.html.outlineVisible).toBe(true);expect(initialViewMode(value,'text')).toBe('source');expect(presentationFor(value,'text').outlineVisible).toBe(false);
    expect(updateFileTypeSettings(value,'text',{viewMode:'split'})).toEqual(normalized);
  });
});
