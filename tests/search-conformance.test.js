import {describe,it,expect} from 'vitest';
import {runSearch} from '../src/search-core.js';
import cases from './fixtures/search-shared.json';

describe('shared browser and Windows search vectors',()=>{
  for(const vector of cases)it(vector.name,()=>{
    expect(runSearch(vector.request)).toEqual(vector.expected);
  });
});
