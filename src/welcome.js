import text from '../examples/Welcome.md?raw';
import {APP_TITLE} from './brand.js';

// Return a fresh untitled document so opening the guide never overwrites a file.
export function welcomeDocument(){
  return {name:APP_TITLE+' の使い方.md',text,savedText:text,needsInitialSave:false};
}
